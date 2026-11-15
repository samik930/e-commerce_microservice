const crypto = require('crypto');
const db = require('../config/db');
const mockRazorpayService = require('../services/mockRazorpayService');
const razorpay = require('../services/razorpayClient');

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://127.0.0.1:5003';

/**
 * Initiate a payment intent / Razorpay order for an existing e-commerce order
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

    // 1. Fetch order details from Order Service (Decoupled service-to-service call)
    let order;
    try {
      const orderResponse = await fetch(`${ORDER_SERVICE_URL}/api/orders/${orderId}`, {
        method: 'GET',
        headers: {
          'x-user-id': String(userId)
        }
      });

      if (orderResponse.status === 404) {
        return res.status(404).json({ message: 'Order not found' });
      }

      if (orderResponse.status === 403) {
        return res.status(403).json({ message: 'Forbidden: You do not own this order' });
      }

      if (!orderResponse.ok) {
        const errorData = await orderResponse.json().catch(() => ({}));
        return res.status(orderResponse.status).json({
          message: errorData.message || 'Failed to fetch order from Order Service'
        });
      }

      order = await orderResponse.json();
    } catch (networkError) {
      console.error('Order service unreachable:', networkError.message);
      return res.status(503).json({ message: 'Order Service unavailable, please try again later' });
    }

    if (order.status === 'Confirmed') {
      return res.status(400).json({ message: 'Order has already been paid and confirmed' });
    }

    if (order.status === 'Cancelled') {
      return res.status(400).json({ message: 'Order has been cancelled and cannot be paid' });
    }

    // 2. Create Razorpay Order (or fallback to Mock Gateway)
    let gatewayOrderId = null;
    let isRealRazorpay = false;

    if (razorpay) {
      try {
        const amountInPaise = Math.round(Number(order.total) * 100);
        const receipt = `rcpt_${String(order.id).replace(/[^a-zA-Z0-9]/g, '').substring(0, 30)}`;
        const rzpOrder = await razorpay.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: receipt,
          notes: {
            orderId: String(order.id),
            userId: String(userId)
          }
        });
        gatewayOrderId = rzpOrder.id;
        isRealRazorpay = true;
        console.log(`💳 [Razorpay] Created live test order ${gatewayOrderId} for Order #${order.id}`);
      } catch (rzpErr) {
        console.error('❌ [Razorpay] Live order creation error, falling back to mock:', rzpErr.message);
      }
    }

    if (!gatewayOrderId) {
      const mockOrder = await mockRazorpayService.createMockOrder({
        amount: order.total,
        currency: 'INR',
        orderId: order.id
      });
      gatewayOrderId = mockOrder.id;
    }

    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 3. Store payment intent in Payment Service database
    const paymentResult = await db.query(
      `INSERT INTO payments (order_id, user_id, amount, currency, status, transaction_id, gateway_order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [order.id, userId, order.total, 'INR', 'PENDING', transactionId, gatewayOrderId]
    );

    // 4. Update order status via Order Service API (Decoupled)
    try {
      await fetch(`${ORDER_SERVICE_URL}/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': String(userId),
          'x-internal-service': 'payment-service'
        },
        body: JSON.stringify({ status: 'Payment_Initiated' })
      });
    } catch (statusUpdateErr) {
      console.warn('Warning: Could not update order status in Order Service:', statusUpdateErr.message);
    }

    const payment = paymentResult.rows[0];

    res.status(201).json({
      message: isRealRazorpay ? 'Razorpay order created successfully' : 'Payment intent created successfully (Mock Gateway)',
      paymentId: payment.id,
      transactionId: payment.transaction_id,
      gatewayOrderId: gatewayOrderId,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      isRealRazorpay: isRealRazorpay,
      keyId: isRealRazorpay ? process.env.RAZORPAY_KEY_ID : null,
      razorpayOrder: isRealRazorpay ? {
        id: gatewayOrderId,
        amount: Math.round(Number(order.total) * 100),
        currency: 'INR',
        key: process.env.RAZORPAY_KEY_ID,
        name: 'Microservice Store',
        description: `Payment for Order #${order.id}`
      } : null,
      razorpayMock: !isRealRazorpay ? {
        key: 'rzp_test_mock_dev_key',
        order_id: gatewayOrderId,
        amount: order.total,
        currency: 'INR',
        name: 'E-Commerce Store (Mock Gateway)',
        description: `Payment for Order #${order.id}`
      } : null
    });

  } catch (error) {
    console.error('Error initiating payment:', error);
    res.status(500).json({ message: 'Server error initiating payment: ' + error.message });
  }
};

/**
 * Verify Razorpay HMAC SHA256 signature and finalize order
 */
exports.verifyPayment = async (req, res) => {
  const client = await db.getClient();
  try {
    const userId = req.headers['x-user-id'];
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: User identity missing' });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing Razorpay signature verification parameters' });
    }

    // 1. Verify HMAC SHA256 signature
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({ message: 'Razorpay secret key not configured on server' });
    }

    const hmac = crypto.createHmac('sha256', keySecret);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');

    const isSignatureValid = generatedSignature === razorpay_signature;

    if (!isSignatureValid) {
      console.warn(`❌ [Razorpay] Invalid signature detected for order ${razorpay_order_id}`);
      return res.status(400).json({ success: false, message: 'Invalid payment signature verification failed' });
    }

    console.log(`✅ [Razorpay] Signature verified successfully for order ${razorpay_order_id}, payment ${razorpay_payment_id}`);

    // 2. Locate payment record
    let paymentQuery = 'SELECT * FROM payments WHERE gateway_order_id = $1';
    let queryParams = [razorpay_order_id];
    if (orderId) {
      paymentQuery = 'SELECT * FROM payments WHERE gateway_order_id = $1 OR order_id = $2 ORDER BY created_at DESC LIMIT 1';
      queryParams = [razorpay_order_id, orderId];
    }

    const paymentResult = await client.query(paymentQuery, queryParams);
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Payment record not found for this gateway order' });
    }

    const payment = paymentResult.rows[0];

    // 3. Mark payment as COMPLETED in DB
    await client.query('BEGIN');
    await client.query(
      `UPDATE payments
       SET status = 'COMPLETED',
           transaction_id = $1,
           payment_method = 'razorpay',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [razorpay_payment_id, payment.id]
    );
    await client.query('COMMIT');

    // 4. Update order status to Confirmed in Order Service
    try {
      await fetch(`${ORDER_SERVICE_URL}/api/orders/${payment.order_id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': String(userId),
          'x-internal-service': 'payment-service'
        },
        body: JSON.stringify({ status: 'Confirmed' })
      });
    } catch (orderErr) {
      console.warn(`Warning: Could not update order ${payment.order_id} status in Order Service:`, orderErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified and order confirmed successfully!',
      transactionId: razorpay_payment_id,
      orderId: payment.order_id,
      status: 'COMPLETED'
    });

  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error verifying payment:', error);
    res.status(500).json({ message: 'Server error verifying payment: ' + error.message });
  } finally {
    client.release();
  }
};

/**
 * Process / Simulate payment completion (Success or Failure) for Mock fallback
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

    // 1. Fetch payment record from Payment Service DB
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

    let newOrderStatus;
    if (result.success) {
      // Update Payment status to COMPLETED
      await client.query(
        `UPDATE payments
         SET status = 'COMPLETED', payment_method = $1, transaction_id = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [paymentMethod, result.transactionId, payment.id]
      );
      newOrderStatus = 'Confirmed';
    } else {
      // Update Payment status to FAILED
      await client.query(
        `UPDATE payments
         SET status = 'FAILED', payment_method = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [paymentMethod, result.errorMessage, payment.id]
      );
      newOrderStatus = 'Payment_Failed';
    }

    await client.query('COMMIT');

    // 3. Notify Order Service of payment outcome (Decoupled API call)
    try {
      await fetch(`${ORDER_SERVICE_URL}/api/orders/${payment.order_id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': String(userId),
          'x-internal-service': 'payment-service'
        },
        body: JSON.stringify({ status: newOrderStatus })
      });
    } catch (orderErr) {
      console.warn(`Warning: Could not update order ${payment.order_id} status in Order Service:`, orderErr.message);
    }

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Payment completed successfully!',
        transactionId: result.transactionId,
        orderId: payment.order_id,
        status: 'COMPLETED',
        paymentMethod
      });
    } else {
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

    // Decoupled query: reads only from payments table without cross-service database JOIN
    const result = await db.query(
      'SELECT p.*, p.amount as order_total FROM payments p WHERE p.user_id = $1 ORDER BY p.created_at DESC',
      [userId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ message: 'Server error fetching payment history' });
  }
};
