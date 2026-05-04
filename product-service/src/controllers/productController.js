const db = require('../config/db');

exports.getProducts = async (req, res) => {
  try {
    const [products] = await db.query('SELECT * FROM products ORDER BY created_at DESC');
    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Server error retrieving products' });
  }
};

exports.getProductById = async (req, res) => {
  try {
    const [product] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (product.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json(product[0]);
  } catch (error) {
    console.error('Error fetching product by ID:', error);
    res.status(500).json({ message: 'Server error retrieving product' });
  }
};
