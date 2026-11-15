const express = require('express');
const router = express.Router();
const multer = require('multer');
const productController = require('../controllers/productController');

// Multer memory storage (keeps file in memory buffer for streaming to Cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

router.get('/', productController.getProducts);
router.post('/', productController.createProduct);
router.post('/upload-image', upload.single('image'), productController.uploadProductImage);
router.get('/:id', productController.getProductById);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);
router.post('/reserve', productController.reserveStock);
router.post('/release', productController.releaseStock);

module.exports = router;
