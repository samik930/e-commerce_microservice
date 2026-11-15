/**
 * ORDER_STATUS — Single Source of Truth for Order Lifecycle States
 *
 * State Machine:
 *
 *  AWAITING_PAYMENT  ◄──────────────────────────────────┐
 *       │                                               │
 *       │ (initiatePayment called)                      │
 *       ▼                                               │
 *  PAYMENT_INITIATED                                    │
 *       │                                               │
 *       ├──(payment succeeds)──────────────► CONFIRMED  │
 *       │                                       │       │
 *       └──(payment fails)──► PAYMENT_FAILED    │       │
 *                                   │           │       │
 *                       (stock      │      (admin/      │
 *                        returned)  │       ops)        │
 *                                   ▼           ▼       │
 *                               CANCELLED   PROCESSING──┘
 *                                               │
 *                                               ▼
 *                                           SHIPPED
 *                                               │
 *                                               ▼
 *                                           DELIVERED
 */

const ORDER_STATUS = {
  // --- Payment Lifecycle ---
  AWAITING_PAYMENT:   'Awaiting_Payment',   // Order created, stock reserved, waiting for payment intent
  PAYMENT_INITIATED:  'Payment_Initiated',  // Payment intent created with gateway (Razorpay order generated)
  CONFIRMED:          'Confirmed',          // Payment successfully captured; order confirmed
  PAYMENT_FAILED:     'Payment_Failed',     // Payment capture failed; stock released back

  // --- Fulfilment Lifecycle ---
  PROCESSING:         'Processing',         // Order confirmed, being prepared / packed
  SHIPPED:            'Shipped',            // Order dispatched to courier
  DELIVERED:          'Delivered',          // Order received by customer

  // --- Terminal State ---
  CANCELLED:          'Cancelled',          // Order cancelled by customer or ops; stock released
};

/**
 * PAYMENT_STATUS — Payment record states owned by payment-service
 */
const PAYMENT_STATUS = {
  PENDING:    'PENDING',    // Payment intent created; awaiting customer action
  COMPLETED:  'COMPLETED',  // Payment captured successfully
  FAILED:     'FAILED',     // Payment capture failed
  REFUNDED:   'REFUNDED',   // Payment refunded (future Kafka event)
};

/**
 * VALID_TRANSITIONS — Defines the legal state machine transitions for order status.
 * key   = current status
 * value = array of statuses this order is allowed to move to
 *
 * Purpose: Prevents invalid status jumps (e.g., jumping from DELIVERED to AWAITING_PAYMENT)
 */
const VALID_TRANSITIONS = {
  [ORDER_STATUS.AWAITING_PAYMENT]:  [ORDER_STATUS.PAYMENT_INITIATED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_INITIATED]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PAYMENT_FAILED],
  [ORDER_STATUS.CONFIRMED]:         [ORDER_STATUS.PROCESSING, ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_FAILED]:    [ORDER_STATUS.AWAITING_PAYMENT, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PROCESSING]:        [ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.SHIPPED]:           [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]:         [],   // Terminal state — no further transitions
  [ORDER_STATUS.CANCELLED]:         [],   // Terminal state — no further transitions
};

/**
 * STOCK_RELEASE_STATUSES — Order statuses that require stock to be released back to inventory.
 * When an order reaches one of these states, reserved stock must be returned.
 */
const STOCK_RELEASE_STATUSES = new Set([
  ORDER_STATUS.PAYMENT_FAILED,
  ORDER_STATUS.CANCELLED,
]);

/**
 * isValidTransition — Validates whether a status move is legal per the state machine.
 * @param {string} currentStatus - The current order status
 * @param {string} nextStatus    - The desired next status
 * @returns {boolean}
 */
function isValidTransition(currentStatus, nextStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(nextStatus);
}

/**
 * requiresStockRelease — Returns true if moving to this status should trigger stock release.
 * @param {string} newStatus
 * @returns {boolean}
 */
function requiresStockRelease(newStatus) {
  return STOCK_RELEASE_STATUSES.has(newStatus);
}

module.exports = {
  ORDER_STATUS,
  PAYMENT_STATUS,
  VALID_TRANSITIONS,
  STOCK_RELEASE_STATUSES,
  isValidTransition,
  requiresStockRelease,
};

