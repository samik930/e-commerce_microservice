const db = require('../config/db');
const redis = require('../config/redis');

exports.getProducts = async (req, res) => {
  try {
    // 1. Check if products exist in Redis cache
    const cachedProducts = await redis.get('products:all');
    
    if (cachedProducts) {
      console.log('📦 Serving products from Redis Cache!');
      // @upstash/redis automatically parses JSON, so we can return it directly
      return res.status(200).json(cachedProducts);
    }

    // 2. If not in cache, fetch from PostgreSQL
    console.log('🗄️ Fetching products from PostgreSQL database...');
    const result = await db.query('SELECT * FROM products ORDER BY created_at DESC');
    const products = result.rows;

    // 3. Store the result in Redis with an expiration (e.g., 5 minutes / 300 seconds)
    if (products.length > 0) {
       await redis.set('products:all', products, { ex: 30 });
    }

    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Server error retrieving products' });
  }
};
