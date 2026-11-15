const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const router = express.Router();

const SERVICES = require("../config/services");
const { verifyToken } = require("../middleware/authMiddleware");
const { authRateLimiter, globalRateLimiter } = require("../middleware/rateLimiter");

// ✅ AUTH SERVICE (Rate limited: 10 requests / min to prevent brute force)
router.use(
  "/auth",
  authRateLimiter,
  createProxyMiddleware({
    target: SERVICES.USER_SERVICE,
    changeOrigin: true,
    pathRewrite: {
      '^/': '/api/auth/'
    },
  }) 
);

// ✅ PRODUCT SERVICE (JWT required, Rate limited: 100 requests / min)
router.use(
  "/products",
  globalRateLimiter,
  verifyToken,
  createProxyMiddleware({
    target: SERVICES.PRODUCT_SERVICE,
    changeOrigin: true,
    pathRewrite: {
      '^/': '/api/products/'
    },
    on: {
      proxyReq: (proxyReq, req) => {
        // 🔒 Strip any client-sent spoofed header, then inject from verified JWT
        proxyReq.removeHeader('x-user-id');
        proxyReq.removeHeader('x-user-email');
        proxyReq.removeHeader('x-user-role');
        if (req.user) {
          proxyReq.setHeader('x-user-id', String(req.user.id));
          proxyReq.setHeader('x-user-email', String(req.user.email || ''));
          proxyReq.setHeader('x-user-role', String(req.user.role || 'customer'));
        }
        console.log("→ PRODUCT SERVICE:", req.method, req.url);
      }
    }
  })
);

// ✅ ORDER SERVICE (JWT required, Rate limited: 100 requests / min)
router.use(
  "/orders",
  globalRateLimiter,
  verifyToken,
  createProxyMiddleware({
    target: SERVICES.ORDER_SERVICE, 
    changeOrigin: true,
    pathRewrite: {
      '^/': '/api/orders/'
    },
    on: {
      proxyReq: (proxyReq, req) => {
        // 🔒 Strip any client-sent spoofed header, then inject from verified JWT
        proxyReq.removeHeader('x-user-id');
        proxyReq.removeHeader('x-user-email');
        proxyReq.removeHeader('x-user-role');
        if (req.user) {
          proxyReq.setHeader('x-user-id', String(req.user.id));
          proxyReq.setHeader('x-user-email', String(req.user.email || ''));
          proxyReq.setHeader('x-user-role', String(req.user.role || 'customer'));
          console.log("→ ORDER SERVICE: injecting x-user-id =", req.user.id, "role =", req.user.role);
        }
        const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
        if (idempotencyKey) {
          proxyReq.setHeader('idempotency-key', idempotencyKey);
        }
        console.log("→ ORDER SERVICE:", req.method, req.url);
      }
    }
  })
);

// ✅ CART SERVICE (JWT required, Rate limited: 100 requests / min)
router.use(
  "/cart",
  globalRateLimiter,
  verifyToken,
  createProxyMiddleware({
    target: SERVICES.ORDER_SERVICE,
    changeOrigin: true,
    pathRewrite: {
      '^/': '/api/cart/'
    },
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader('x-user-id');
        proxyReq.removeHeader('x-user-email');
        proxyReq.removeHeader('x-user-role');
        if (req.user) {
          proxyReq.setHeader('x-user-id', String(req.user.id));
          proxyReq.setHeader('x-user-email', String(req.user.email || ''));
          proxyReq.setHeader('x-user-role', String(req.user.role || 'customer'));
        }
        console.log("→ CART SERVICE (Order Service):", req.method, req.url);
      }
    }
  })
);

// ✅ PAYMENT SERVICE (JWT required, Rate limited: 100 requests / min)
router.use(
  "/payments",
  globalRateLimiter,
  verifyToken,
  createProxyMiddleware({
    target: SERVICES.PAYMENT_SERVICE,
    changeOrigin: true,
    pathRewrite: {
      '^/': '/api/payments/'
    },
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader('x-user-id');
        proxyReq.removeHeader('x-user-email');
        proxyReq.removeHeader('x-user-role');
        if (req.user) {
          proxyReq.setHeader('x-user-id', String(req.user.id));
          proxyReq.setHeader('x-user-email', String(req.user.email || ''));
          proxyReq.setHeader('x-user-role', String(req.user.role || 'customer'));
          console.log("→ PAYMENT SERVICE: injecting x-user-id =", req.user.id);
        }
        const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
        if (idempotencyKey) {
          proxyReq.setHeader('idempotency-key', idempotencyKey);
        }
        console.log("→ PAYMENT SERVICE:", req.method, req.url);
      }
    }
  })
);

module.exports = router;