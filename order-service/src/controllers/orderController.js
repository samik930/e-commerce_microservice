const db = require('../config/db');

exports.getOrders = async (req, res) => {
  try {
    // Basic fetch: in a real app filter by user_id
    const [orders] = await db.query('SELECT * FROM orders ORDER BY created_at DESC');

    // Fetch order items for each order
    for (let order of orders) {
      const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      order.items = items;
    }

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Server error retrieving orders' });
  }
};

exports.createOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { items } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items array is required to place an order' });
    }

    const userId = req.headers['x-user-id'] || 1;

    // Calculate total
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    await connection.beginTransaction();

    // Insert Order
    const [orderResult] = await connection.query(
      'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)',
      [userId, total, 'Placed']
    );

    const orderId = orderResult.insertId;

    // Insert Order Items
    for (let item of items) {
      await connection.query(
        'INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
        [orderId, item.productId, item.name || `Product ${item.productId}`, item.quantity, item.price]
      );
    }

    await connection.commit();

    // Fetch full newly created order structure
    const [newOrder] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    const [newOrderItems] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
    newOrder[0].items = newOrderItems;

    res.status(201).json(newOrder[0]);
  } catch (error) {
    await connection.rollback();
    console.error('Error creating order:', error);
    res.status(500).json({ message: 'Server error creating order' });
  } finally {
    connection.release();
  }
};
