const redis = require("../config/redis");

/**
 * Higher-order function to create custom rate limiters
 * @param {Object} options 
 * @param {number} options.windowInSeconds Time window in seconds (e.g. 60)
 * @param {number} options.maxRequests Max allowed requests in window (e.g. 10 or 100)
 * @param {string} options.prefix Prefix for Redis key
 */
const createRateLimiter = ({ windowInSeconds = 60, maxRequests = 100, prefix = "ratelimit" } = {}) => {
  return async (req, res, next) => {
    try {
      // Determine client IP
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "127.0.0.1";
      const key = `${prefix}:${ip}:${req.path}`;

      // Increment request count in Redis
      const currentRequests = await redis.incr(key);

      // If it's the first request in this window, set expiration
      if (currentRequests === 1) {
        await redis.expire(key, windowInSeconds);
      }

      // Get remaining TTL
      const ttl = await redis.ttl(key);
      const remaining = Math.max(0, maxRequests - currentRequests);

      // Set standard RateLimit headers 
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", ttl > 0 ? ttl : windowInSeconds);

      if (currentRequests > maxRequests) {
        console.warn(`⚠️ Rate limit exceeded for IP: ${ip} on path: ${req.path}`);
        return res.status(429).json({
          error: "Too Many Requests",
          message: `Rate limit exceeded. Please try again in ${ttl > 0 ? ttl : windowInSeconds} seconds.`,
          retryAfterSeconds: ttl > 0 ? ttl : windowInSeconds
        });
      }

      next();
    } catch (error) {
      console.error("Redis Rate Limiter Error:", error);
      // In case of Redis connection issue, fail open so traffic is not blocked
      next();
    }
  };
};

const globalRateLimiter = createRateLimiter({
  windowInSeconds: 60,
  maxRequests: 100,
  prefix: "rl:global"
});

const authRateLimiter = createRateLimiter({
  windowInSeconds: 60,
  maxRequests: 10, // Max 10 requests per minute for login/register
  prefix: "rl:auth"
});

module.exports = {
  createRateLimiter,
  globalRateLimiter,
  authRateLimiter
};
