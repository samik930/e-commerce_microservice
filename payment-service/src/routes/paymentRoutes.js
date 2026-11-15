const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.post('/initiate', paymentController.initiatePayment);
router.post('/process', paymentController.processPayment);
router.post('/verify', paymentController.verifyPayment);
router.get('/order/:orderId', paymentController.getPaymentByOrderId);
router.get('/history', paymentController.getPaymentHistory);

module.exports = router;
  