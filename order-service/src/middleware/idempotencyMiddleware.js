const db = require('../config/db');

/**
 * Idempotency Middleware for mutating HTTP requests (e.g., POST /orders)
 *
 * Header: Idempotency-Key: <UUID>
 *
 * 1. If no Idempotency-Key header is supplied, simply pass through (fail-open / opt-in).
 * 2. If Idempotency-Key is present, query idempotency_keys table for (key, user_id).
 * 3. If found:
 *    - Short-circuit the request pipeline.
 *    - Return cached response status and body directly with header 'X-Idempotent-Replay: true'.
 * 4. If not found:
 *    - Intercept `res.json`.
 *    - Execute downstream controller.
 *    - When response finishes (2xx or 4xx), asynchronously persist the key, endpoint, status, and response_body.
 */
module.exports = async function idempotencyMiddleware(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
  const userId = req.headers['x-user-id'];

  if (!idempotencyKey || !userId) {
    return next();
  }

  try {
    const existing = await db.query(
      'SELECT response_status, response_body FROM idempotency_keys WHERE key = $1 AND user_id = $2',
      [idempotencyKey, userId]
    );

    if (existing.rows.length > 0) {
      const cached = existing.rows[0];
      console.log(`🛡️ [Idempotency] Duplicate request intercepted for key "${idempotencyKey}". Returning cached response.`);
      res.setHeader('X-Idempotent-Replay', 'true');
      return res.status(cached.response_status).json(cached.response_body);
    }

    // Intercept res.json to cache response upon successful completion
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      res.json = originalJson;
      const status = res.statusCode || 200;

      // Only cache non-500 responses
      if (status < 500) {
        db.query(
          `INSERT INTO idempotency_keys (key, user_id, endpoint, response_status, response_body)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (key, user_id) DO NOTHING`,
          [idempotencyKey, userId, req.originalUrl || req.url, status, JSON.stringify(body)]
        ).catch(err => {
          console.error('⚠️ [Idempotency] Failed to cache idempotency key:', err.message);
        });
      }

      return originalJson(body);
    };

    next();
  } catch (error) {
    console.error('⚠️ [Idempotency] Error in idempotency middleware:', error.message);
    next();
  }
};

