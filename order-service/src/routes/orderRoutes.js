const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const idempotencyMiddleware = require('../middleware/idempotencyMiddleware');

router.get('/', orderController.getOrders);
router.get('/analytics/summary', orderController.getSellerAnalytics);
router.post('/', idempotencyMiddleware, orderController.createOrder);
router.get('/:id', orderController.getOrderById);
router.patch('/:id/status', orderController.updateOrderStatus);

module.exports = router;
