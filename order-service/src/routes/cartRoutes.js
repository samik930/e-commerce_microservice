const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');

router.get('/', cartController.getCart);
router.post('/', cartController.saveCart);
router.delete('/', cartController.clearCart);

module.exports = router;
