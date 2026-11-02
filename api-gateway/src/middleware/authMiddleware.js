const jwt = require("jsonwebtoken");
const redis = require("../config/redis");

exports.verifyToken = async (req, res, next) => {
  try {
    // 🔒 Read token from HttpOnly cookie
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: "No token provided (Cookie missing)" });
    }

    // 🚫 Check if token is in Redis blacklist (revoked upon logout)
    try {
      const isBlacklisted = await redis.get(`bl:${token}`);
      if (isBlacklisted) {
        return res.status(401).json({ message: "Unauthorized: Token has been revoked (logged out)" });
      }
    } catch (redisErr) {
      console.error("Redis blacklist check error:", redisErr);
      // Fail safe: proceed with JWT verify if Redis check errors
    }

    // verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // attach user info to request
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized: Invalid or expired token" });
  }
};