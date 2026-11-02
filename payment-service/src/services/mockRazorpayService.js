const crypto = require("crypto");

/**
 * Mock Razorpay Gateway Service
 * Emulates official Razorpay API responses without requiring API keys or PAN verification.
 */
class MockRazorpayService {
  /**
   * Create a mock Razorpay Order
   * @param {Object} params - { amount, currency, receipt, orderId }
   * @returns {Object} Mock Razorpay Order object
   */
  async createMockOrder({ amount, currency = "INR", orderId }) {
    const amountInPaise = Math.round(Number(amount) * 100);
    const mockOrder = {
      id: `order_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      entity: "order",
      amount: amountInPaise,
      amount_paid: 0,
      amount_due: amountInPaise,
      currency: currency,
      receipt: `rcpt_${orderId.toString().substring(0, 8)}`,
      status: "created",
      attempts: 0,
      notes: {
        internal_order_id: orderId,
        gateway_mode: "mock_development"
      },
      created_at: Math.floor(Date.now() / 1000)
    };

    return mockOrder;
  }

  /**
   * Generate a mock Razorpay payment ID & HMAC signature
   * @param {string} razorpayOrderId 
   * @param {string} secret 
   */
  generateMockSignature(razorpayOrderId, razorpayPaymentId, secret = "mock_secret_key") {
    const text = `${razorpayOrderId}|${razorpayPaymentId}`;
    return crypto.createHmac("sha256", secret).update(text).digest("hex");
  }

  /**
   * Process and simulate a payment transaction
   * @param {Object} params - { razorpayOrderId, paymentMethod, simulateStatus }
   */
  async processPayment({ razorpayOrderId, paymentMethod = "mock_card", simulateStatus = "success" }) {
    const isSuccess = simulateStatus.toLowerCase() === "success";
    const paymentId = `pay_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const signature = this.generateMockSignature(razorpayOrderId, paymentId);

    if (isSuccess) {
      return {
        success: true,
        transactionId: paymentId,
        gatewayOrderId: razorpayOrderId,
        signature: signature,
        paymentMethod: paymentMethod,
        status: "COMPLETED",
        message: "Mock Payment Processed Successfully (Development Mode)"
      };
    } else {
      return {
        success: false,
        transactionId: paymentId,
        gatewayOrderId: razorpayOrderId,
        paymentMethod: paymentMethod,
        status: "FAILED",
        errorMessage: "Mock Payment Failed (User Simulated Failure)"
      };
    }
  }
}

module.exports = new MockRazorpayService();
