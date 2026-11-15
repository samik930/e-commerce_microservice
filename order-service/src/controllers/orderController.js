const db = require('../config/db');
const redis = require('../config/redis');
const {
  ORDER_STATUS,
  isValidTransition,
  requiresStockRelease,
} = require('../config/orderStatus');

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://127.0.0.1:5002';

exports.getOrders = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    let ordersResult;
    if (userRole === 'seller') {
      // Sellers see all platform orders with customer details
      ordersResult = await db.query(
        `SELECT o.*, u.name as customer_name, u.email as customer_email 
         FROM orders o 
         LEFT JOIN users u ON o.user_id = u.id 
         ORDER BY o.created_at DESC`
      );
    } else {
      // Customers see only their own orders
      ordersResult = await db.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
    }
    const orders = ordersResult.rows;

    for (let order of orders) {
      const itemsResult = await db.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [order.id]
      );
      order.items = itemsResult.rows;
    }

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Server error retrieving orders' });
  }
};

exports.createOrder = async (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Items array is required to place an order' });
  }

  const userId = req.headers['x-user-id'];

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: User identity missing' });
  }

  const reserveItems = items.map(item => ({
    productId: item.productId || item.id,
    quantity: item.quantity
  }));

  const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
  const reservePayload = {
    items: reserveItems,
    reservationId: idempotencyKey ? `order-res-${idempotencyKey}` : undefined
  };

  // 1. 📦 Reserve stock in Product Service (stock deducted atomically)
  try {
    const reserveResponse = await fetch(`${PRODUCT_SERVICE_URL}/api/products/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': String(userId),
        'x-internal-service': 'order-service'
      },
      body: JSON.stringify(reservePayload)
    });

    if (!reserveResponse.ok) {
      const errorData = await reserveResponse.json().catch(() => ({}));
      console.error(`[Order Service] Stock reservation failed (HTTP ${reserveResponse.status}):`, errorData);
      return res.status(reserveResponse.status).json({
        message: errorData.message || `Failed to reserve product stock (Product Service HTTP ${reserveResponse.status})`
      });
    }
  } catch (networkError) {
    console.error('Product Service unreachable for stock reservation:', networkError.message);
    return res.status(503).json({ message: 'Product Service unavailable for stock check, please retry' });
  }

  // 2. Persist order — initial status: AWAITING_PAYMENT (stock is now reserved)
  const client = await db.getClient();
  try {
    const total = items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);

    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, total, status) VALUES ($1, $2, $3) RETURNING *',
      [userId, total, ORDER_STATUS.AWAITING_PAYMENT]
    );

    const createdOrder = orderResult.rows[0];

    for (let item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, $3, $4, $5)',
        [
          createdOrder.id,
          item.productId || item.id,
          item.name || `Product ${item.productId || item.id}`,
          item.quantity,
          item.price
        ]
      );
    }

    await client.query('COMMIT');

    // 3. 🛒 Clear user's cart in Redis after order is persisted
    try {
      await redis.del(`cart:${userId}`);
    } catch (redisErr) {
      console.error('Failed to clear cart from Redis:', redisErr);
    }

    const newOrderItems = await db.query('SELECT * FROM order_items WHERE order_id = $1', [createdOrder.id]);
    createdOrder.items = newOrderItems.rows;

    res.status(201).json(createdOrder);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}

    // 4. 🔄 Compensating rollback: release stock since the order failed to persist
    try {
      await fetch(`${PRODUCT_SERVICE_URL}/api/products/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-service': 'order-service'
        },
        body: JSON.stringify({ items: reserveItems })
      });
    } catch (releaseErr) {
      console.error('Failed to release stock after order creation rollback:', releaseErr.message);
    }

    console.error('Error creating order:', error.message);
    res.status(500).json({ message: 'Server error creating order: ' + error.message });
  } finally {
    client.release();
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    const orderResult = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orderResult.rows[0];
    if (String(order.user_id) !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden: You do not own this order' });
    }

    const itemsResult = await db.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    order.items = itemsResult.rows;

    res.status(200).json(order);
  } catch (error) {
    console.error('Error fetching order by ID:', error);
    res.status(500).json({ message: 'Server error retrieving order' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const isSeller = userRole === 'seller';
    const isInternalService = req.headers['x-internal-service'] === 'payment-service';
    const { id } = req.params;
    const { status } = req.body;

    if (!userId && !isInternalService) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    // Reject any status value not in the canonical set
    const knownStatuses = Object.values(ORDER_STATUS);
    if (!knownStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid order status: "${status}". Allowed values: ${knownStatuses.join(', ')}`
      });
    }

    const orderResult = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orderResult.rows[0];

    // Regular users can only modify their own orders; sellers and internal services can update any order
    if (userId && !isInternalService && !isSeller && String(order.user_id) !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden: You do not own this order' });
    }

    // 🚦 State Machine Validation — block illegal transitions
    if (!isValidTransition(order.status, status)) {
      return res.status(409).json({
        message: `Invalid status transition: "${order.status}" → "${status}" is not permitted`,
        currentStatus: order.status,
        requestedStatus: status,
        allowedTransitions: Object.values(require('../config/orderStatus').VALID_TRANSITIONS[order.status] || [])
      });
    }

    // 🔄 Release stock when transitioning to a failure or cancellation state
    if (requiresStockRelease(status)) {
      try {
        const itemsResult = await db.query(
          'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
          [id]
        );
        const releaseItems = itemsResult.rows.map(item => ({
          productId: item.product_id,
          quantity: item.quantity
        }));

        const releaseId = `order-rel-${id}-${status}`;
        await fetch(`${PRODUCT_SERVICE_URL}/api/products/release`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-service': 'order-service'
          },
          body: JSON.stringify({ items: releaseItems, releaseId })
        });
      } catch (releaseErr) {
        console.error('Failed to release stock on order status transition:', releaseErr.message);
      }
    }

    const updatedOrderResult = await db.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    res.status(200).json(updatedOrderResult.rows[0]);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: 'Server error updating order status' });
  }
};

/**
 * Get Seller Analytics Summary (Total Revenue, Orders Count, Recent Sales)
 */
exports.getSellerAnalytics = async (req, res) => {
  try {
    const userRole = req.headers['x-user-role'];
    if (userRole !== 'seller') {
      return res.status(403).json({ message: 'Forbidden: Only sellers can access sales analytics' });
    }

    // Revenue from confirmed/processing/shipped/delivered orders
    const revenueRes = await db.query(
      `SELECT COALESCE(SUM(total), 0) as total_revenue, COUNT(*) as total_orders
       FROM orders
       WHERE status IN ('Confirmed', 'Processing', 'Shipped', 'Delivered')`
    );

    // Count breakdown by status
    const statusCountsRes = await db.query(
      `SELECT status, COUNT(*) as count FROM orders GROUP BY status`
    );

    // Recent 15 sales with customer details
    const recentSalesRes = await db.query(
      `SELECT o.id, o.total, o.status, o.created_at, u.name as customer_name, u.email as customer_email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC
       LIMIT 15`
    );

    res.status(200).json({
      totalRevenue: parseFloat(revenueRes.rows[0].total_revenue),
      totalOrders: parseInt(revenueRes.rows[0].total_orders, 10),
      statusBreakdown: statusCountsRes.rows,
      recentSales: recentSalesRes.rows
    });
  } catch (error) {
    console.error('Error fetching seller analytics:', error);
    res.status(500).json({ message: 'Server error retrieving analytics: ' + error.message });
  }
};
