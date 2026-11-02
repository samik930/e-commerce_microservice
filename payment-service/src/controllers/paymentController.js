const db = require('../config/db');
const mockRazorpayService = require('../services/mockRazorpayService');

/**
 * Initiate a payment intent / mock Razorpay order for an existing e-commerce order
 */
exports.initiatePayment = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { orderId } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    if (!orderId) {
      return res.status(400).json({ message: 'Order ID is required to initiate payment' });
    }

    // 1. Verify order existence and user ownership
    const orderResult = await db.query(
      'SELECT id, user_id, total, status FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orderResult.rows[0];

    if (String(order.user_id) !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden: You do not own this order' });
    }

    if (order.status === 'Paid') {
      return res.status(400).json({ message: 'Order has already been paid' });
    }

    // 2. Create Mock Razorpay Order
    const mockOrder = await mockRazorpayService.createMockOrder({
      amount: order.total,
      currency: 'INR',
      orderId: order.id
    });

    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 3. Store payment intent in PostgreSQL
    const paymentResult = await db.query(
      `INSERT INTO payments (order_id, user_id, amount, currency, status, transaction_id, gateway_order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [order.id, userId, order.total, 'INR', 'PENDING', transactionId, mockOrder.id]
    );

    // 4. Update order status to Pending_Payment
    await db.query(
      "UPDATE orders SET status = 'Pending_Payment' WHERE id = $1",
      [order.id]
    );

    const payment = paymentResult.rows[0];

    res.status(201).json({
      message: 'Payment intent created successfully (Mock Gateway)',
      paymentId: payment.id,
      transactionId: payment.transaction_id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      razorpayMock: {
        key: 'rzp_test_mock_dev_key',
        order_id: mockOrder.id,
        amount: mockOrder.amount,
        currency: mockOrder.currency,
        name: 'E-Commerce Store (Mock Gateway)',
        description: `Payment for Order #${order.id}`
      }
    });

  } catch (error) {
    console.error('Error initiating payment:', error);
    res.status(500).json({ message: 'Server error initiating payment: ' + error.message });
  }
};

/**
 * Process / Simulate payment completion (Success or Failure)
 */
exports.processPayment = async (req, res) => {
  const client = await db.getClient();
  try {
    const userId = req.headers['x-user-id'];
    const { paymentId, orderId, paymentMethod = 'mock_card', simulateStatus = 'success' } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    if (!paymentId && !orderId) {
      return res.status(400).json({ message: 'paymentId or orderId is required' });
    }

    // 1. Fetch payment record
    let paymentQuery;
    let queryParams;

    if (paymentId) {
      paymentQuery = 'SELECT * FROM payments WHERE id = $1';
      queryParams = [paymentId];
    } else {
      paymentQuery = 'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1';
      queryParams = [orderId];
    }

    const paymentResult = await client.query(paymentQuery, queryParams);

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Payment intent record not found' });
    }

    const payment = paymentResult.rows[0];

    if (String(payment.user_id) !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden: You do not own this payment transaction' });
    }

    if (payment.status === 'COMPLETED') {
      return res.status(400).json({ message: 'Payment transaction is already completed' });
    }

    // 2. Process mock payment simulation
    const result = await mockRazorpayService.processPayment({
      razorpayOrderId: payment.gateway_order_id || `order_mock_${payment.order_id}`,
      paymentMethod,
      simulateStatus
    });

    await client.query('BEGIN');

    if (result.success) {
      // Update Payment status to COMPLETED
      await client.query(
        `UPDATE payments
         SET status = 'COMPLETED', payment_method = $1, transaction_id = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [paymentMethod, result.transactionId, payment.id]
      );

      // Update Order status to Paid
      await client.query(
        "UPDATE orders SET status = 'Paid', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [payment.order_id]
      );

      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        message: 'Payment completed successfully!',
        transactionId: result.transactionId,
        orderId: payment.order_id,
        status: 'COMPLETED',
        paymentMethod
      });
    } else {
      // Update Payment status to FAILED
      await client.query(
        `UPDATE payments
         SET status = 'FAILED', payment_method = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [paymentMethod, result.errorMessage, payment.id]
      );

      // Update Order status to Payment_Failed
      await client.query(
        "UPDATE orders SET status = 'Payment_Failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [payment.order_id]
      );

      await client.query('COMMIT');

      return res.status(400).json({
        success: false,
        message: result.errorMessage || 'Payment failed',
        transactionId: result.transactionId,
        orderId: payment.order_id,
        status: 'FAILED',
        paymentMethod
      });
    }

  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error processing payment:', error);
    res.status(500).json({ message: 'Server error processing payment: ' + error.message });
  } finally {
    client.release();
  }
};

/**
 * Get payment status/details by Order ID
 */
exports.getPaymentByOrderId = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { orderId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    const result = await db.query(
      'SELECT * FROM payments WHERE order_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [orderId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No payment record found for this order' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching payment by orderId:', error);
    res.status(500).json({ message: 'Server error fetching payment details' });
  }
};

/**
 * Get payment history for authenticated user
 */
exports.getPaymentHistory = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    const result = await db.query(
      'SELECT p.*, o.total as order_total FROM payments p JOIN orders o ON p.order_id = o.id WHERE p.user_id = $1 ORDER BY p.created_at DESC',
      [userId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ message: 'Server error fetching payment history' });
  }
};
