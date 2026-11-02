const db = require('../config/db');
const redis = require('../config/redis');

exports.getOrders = async (req, res) => {
  try {
    // 🔒 SECURITY FIX: Only return orders belonging to the authenticated user
    const userId = req.headers['x-user-id'];

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    // Filter orders by the authenticated user's ID only
    const ordersResult = await db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    const orders = ordersResult.rows;

    // Fetch order items for each order
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

  // 🔒 SECURITY: Get authenticated user ID from gateway-forwarded header
  const userId = req.headers['x-user-id'];

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: User identity missing' });
  }

  const client = await db.getClient();
  try {
    const total = items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);

    await client.query('BEGIN');

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, total, status) VALUES ($1, $2, $3) RETURNING *',
      [userId, total, 'Pending_Payment']
    );

    const createdOrder = orderResult.rows[0];

    for (let item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, $3, $4, $5)',
        [createdOrder.id, item.productId, item.name || `Product ${item.productId}`, item.quantity, item.price]
      );
    }

    await client.query('COMMIT');

    // 🛒 Clear user's cart in Redis after order placement
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
    const { id } = req.params;
    const { status } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    const orderResult = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orderResult.rows[0];
    if (String(order.user_id) !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden: You do not own this order' });
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
