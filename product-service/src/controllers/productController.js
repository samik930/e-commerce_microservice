const db = require('../config/db');
const redis = require('../config/redis');

/**
 * Get all products (Cache-Aside with Upstash Redis)
 */
exports.getProducts = async (req, res) => {
  try {
    // 1. Check if products exist in Redis cache
    const cachedProducts = await redis.get('products:all');
    
    if (cachedProducts) {
      console.log('📦 Serving products from Redis Cache!');
      return res.status(200).json(cachedProducts);
    }

    // 2. If not in cache, fetch from PostgreSQL
    console.log('🗄️ Fetching products from PostgreSQL database...');
    const result = await db.query('SELECT * FROM products ORDER BY created_at DESC');
    const products = result.rows;

    // 3. Store result in Redis with 30s TTL
    if (products.length > 0) {
      await redis.set('products:all', products, { ex: 30 });
    }

    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Server error retrieving products' });
  }
};

/**
 * Get a single product by ID
 */
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM products WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching product by ID:', error);
    res.status(500).json({ message: 'Server error retrieving product' });
  }
};

// Helper to safely obtain a database client from pool
const getDbClient = async () => {
  if (typeof db.getClient === 'function') {
    return await db.getClient();
  }
  if (db.pool && typeof db.pool.connect === 'function') {
    return await db.pool.connect();
  }
  throw new Error('Database client acquisition failed: neither getClient nor pool.connect is available');
};

/**
 * Atomically reserve stock for an array of items (e.g., during order placement)
 * Payload: { items: [{ productId, quantity }], reservationId?: string }
 */
exports.reserveStock = async (req, res) => {
  const { items, reservationId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Items array is required to reserve stock' });
  }

  // 🛡️ Deduplication Guard (Idempotent Consumer Pattern)
  if (reservationId) {
    try {
      const existing = await db.query(
        'SELECT response_payload FROM processed_events WHERE event_id = $1 AND consumer_service = $2',
        [reservationId, 'product-service']
      );
      if (existing.rows.length > 0) {
        console.log(`🛡️ [Idempotent Consumer] Reservation "${reservationId}" already processed. Returning cached result.`);
        return res.status(200).json(existing.rows[0].response_payload);
      }
    } catch (dedupErr) {
      console.warn('Warning: processed_events check error:', dedupErr.message);
    }
  }

  let client;
  try {
    client = await getDbClient();
    await client.query('BEGIN');

    for (const item of items) {
      const productId = item.productId || item.id;
      const qty = parseInt(item.quantity, 10);

      if (!productId || isNaN(qty) || qty <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Invalid product ID or quantity: ${productId}` });
      }

      // Row-level lock (FOR UPDATE) prevents race conditions on concurrent checkouts
      const productResult = await client.query(
        'SELECT id, name, stock FROM products WHERE id = $1 FOR UPDATE',
        [productId]
      );

      if (productResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: `Product not found: ${productId}` });
      }

      const product = productResult.rows[0];

      if (product.stock < qty) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Insufficient stock for "${product.name}". Available: ${product.stock}, Requested: ${qty}`,
          productId: product.id,
          availableStock: product.stock,
          requestedQuantity: qty
        });
      }

      // Deduct stock
      await client.query(
        'UPDATE products SET stock = stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [qty, productId]
      );
    }

    const responsePayload = {
      message: 'Stock reserved successfully',
      reservedItems: items,
      reservationId: reservationId || null
    };

    // 🛡️ Record in processed_events atomically inside the same transaction
    if (reservationId) {
      try {
        await client.query('SAVEPOINT sp_events');
        await client.query(
          `INSERT INTO processed_events (event_id, event_type, consumer_service, response_payload)
           VALUES ($1, 'STOCK_RESERVED', 'product-service', $2)
           ON CONFLICT (event_id, consumer_service) DO NOTHING`,
          [reservationId, JSON.stringify(responsePayload)]
        );
        await client.query('RELEASE SAVEPOINT sp_events');
      } catch (eventErr) {
        await client.query('ROLLBACK TO SAVEPOINT sp_events');
        console.warn('Warning: Could not record in processed_events (non-blocking):', eventErr.message);
      }
    }

    await client.query('COMMIT');

    // Invalidate product catalog cache in Redis so real-time stock is reflected
    try {
      await redis.del('products:all');
    } catch (redisErr) {
      console.warn('Warning: Could not invalidate products:all in Redis:', redisErr.message);
    }

    res.status(200).json(responsePayload);

  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('Error reserving stock:', error);
    res.status(500).json({ message: 'Server error reserving stock: ' + error.message });
  } finally {
    if (client) client.release();
  }
};

/**
 * Release/restore stock for an array of items (e.g. order cancelled or payment failed)
 * Payload: { items: [{ productId, quantity }], releaseId?: string }
 */
exports.releaseStock = async (req, res) => {
  const { items, releaseId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Items array is required to release stock' });
  }

  // 🛡️ Deduplication Guard (Idempotent Consumer Pattern)
  if (releaseId) {
    try {
      const existing = await db.query(
        'SELECT response_payload FROM processed_events WHERE event_id = $1 AND consumer_service = $2',
        [releaseId, 'product-service']
      );
      if (existing.rows.length > 0) {
        console.log(`🛡️ [Idempotent Consumer] Release "${releaseId}" already processed. Returning cached result.`);
        return res.status(200).json(existing.rows[0].response_payload);
      }
    } catch (dedupErr) {
      console.warn('Warning: processed_events check error:', dedupErr.message);
    }
  }

  let client;
  try {
    client = await getDbClient();
    await client.query('BEGIN');

    for (const item of items) {
      const productId = item.productId || item.id;
      const qty = parseInt(item.quantity, 10);

      if (productId && !isNaN(qty) && qty > 0) {
        await client.query(
          'UPDATE products SET stock = stock + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [qty, productId]
        );
      }
    }

    const responsePayload = {
      message: 'Stock released successfully',
      releasedItems: items,
      releaseId: releaseId || null
    };

    // 🛡️ Record in processed_events atomically inside the same transaction
    if (releaseId) {
      try {
        await client.query('SAVEPOINT sp_events');
        await client.query(
          `INSERT INTO processed_events (event_id, event_type, consumer_service, response_payload)
           VALUES ($1, 'STOCK_RELEASED', 'product-service', $2)
           ON CONFLICT (event_id, consumer_service) DO NOTHING`,
          [releaseId, JSON.stringify(responsePayload)]
        );
        await client.query('RELEASE SAVEPOINT sp_events');
      } catch (eventErr) {
        await client.query('ROLLBACK TO SAVEPOINT sp_events');
        console.warn('Warning: Could not record in processed_events (non-blocking):', eventErr.message);
      }
    }

    await client.query('COMMIT');

    // Invalidate product catalog cache
    try {
      await redis.del('products:all');
    } catch (redisErr) {
      console.warn('Warning: Could not invalidate products:all in Redis:', redisErr.message);
    }

    res.status(200).json(responsePayload);

  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('Error releasing stock:', error);
    res.status(500).json({ message: 'Server error releasing stock: ' + error.message });
  } finally {
    if (client) client.release();
  }
};

const { uploadToCloudinary, isConfigured } = require('../config/cloudinary');

/**
 * Upload a product image to Cloudinary (Seller only)
 */
exports.uploadProductImage = async (req, res) => {
  try {
    const role = req.headers['x-user-role'];
    if (role && role !== 'seller') {
      return res.status(403).json({ message: 'Forbidden: Only sellers can upload product images' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided in request' });
    }

    if (!isConfigured()) {
      return res.status(503).json({
        message: 'Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in environment variables.'
      });
    }

    const result = await uploadToCloudinary(req.file.buffer, 'microservice-products');

    res.status(200).json({
      success: true,
      imageUrl: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      width: result.width,
      height: result.height
    });
  } catch (error) {
    console.error('Error uploading product image to Cloudinary:', error);
    res.status(500).json({ message: 'Image upload failed: ' + error.message });
  }
};

/**
 * Create a new product (Seller only)
 */
exports.createProduct = async (req, res) => {
  try {
    const role = req.headers['x-user-role'];
    if (role && role !== 'seller') {
      return res.status(403).json({ message: 'Forbidden: Only sellers can create products' });
    }

    const { name, description, price, stock, attributes, imageUrl } = req.body;
    if (!name || price === undefined || stock === undefined) {
      return res.status(400).json({ message: 'Name, price, and stock are required' });
    }

    const finalAttributes = {
      ...(attributes || {}),
      ...(imageUrl ? { imageUrl } : {})
    };

    const result = await db.query(
      `INSERT INTO products (name, description, price, stock, attributes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description || '', parseFloat(price), parseInt(stock, 10), JSON.stringify(finalAttributes)]
    );

    // Invalidate product catalog cache
    try {
      await redis.del('products:all');
    } catch (_) {}

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ message: 'Server error creating product: ' + error.message });
  }
};

/**
 * Update an existing product (Seller only)
 */
exports.updateProduct = async (req, res) => {
  try {
    const role = req.headers['x-user-role'];
    if (role && role !== 'seller') {
      return res.status(403).json({ message: 'Forbidden: Only sellers can update products' });
    }

    const { id } = req.params;
    const { name, description, price, stock, attributes, imageUrl } = req.body;

    const existing = await db.query('SELECT * FROM products WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const current = existing.rows[0];
    const newName = name !== undefined ? name : current.name;
    const newDesc = description !== undefined ? description : current.description;
    const newPrice = price !== undefined ? parseFloat(price) : current.price;
    const newStock = stock !== undefined ? parseInt(stock, 10) : current.stock;
    
    let currentAttrs = current.attributes || {};
    if (typeof currentAttrs === 'string') {
      try { currentAttrs = JSON.parse(currentAttrs); } catch (_) { currentAttrs = {}; }
    }
    const mergedAttrs = {
      ...currentAttrs,
      ...(attributes || {}),
      ...(imageUrl !== undefined ? { imageUrl } : {})
    };

    const result = await db.query(
      `UPDATE products 
       SET name = $1, description = $2, price = $3, stock = $4, attributes = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [newName, newDesc, newPrice, newStock, JSON.stringify(mergedAttrs), id]
    );

    // Invalidate product catalog cache
    try {
      await redis.del('products:all');
    } catch (_) {}

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ message: 'Server error updating product: ' + error.message });
  }
};

/**
 * Delete a product (Seller only)
 */
exports.deleteProduct = async (req, res) => {
  try {
    const role = req.headers['x-user-role'];
    if (role && role !== 'seller') {
      return res.status(403).json({ message: 'Forbidden: Only sellers can delete products' });
    }

    const { id } = req.params;
    const existing = await db.query('SELECT * FROM products WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await db.query('DELETE FROM products WHERE id = $1', [id]);

    // Invalidate product catalog cache
    try {
      await redis.del('products:all');
    } catch (_) {}

    res.status(200).json({ message: 'Product deleted successfully', id });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Server error deleting product: ' + error.message });
  }
};
