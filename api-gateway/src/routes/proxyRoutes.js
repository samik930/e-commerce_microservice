const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const router = express.Router();

const SERVICES = require("../config/services");
const { verifyToken } = require("../middleware/authMiddleware");

router.use(
  "/auth",
  createProxyMiddleware({
    target: SERVICES.USER_SERVICE,
    changeOrigin: true,
    pathRewrite: {
      '^/': '/api/auth/'
    },
    logLevel: "debug",        // ADD THIS (important)
  })
);

// ✅ PRODUCT SERVICE
router.use(
  "/products",
  verifyToken,
  createProxyMiddleware({
    target: SERVICES.PRODUCT_SERVICE,
    changeOrigin: true,
    pathRewrite: {
      '^/': '/api/products/'
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log("Proxying to PRODUCT SERVICE:", req.method, req.url);
    },
  })
);

// ✅ ORDER SERVICE
router.use(
  "/orders",
  verifyToken,
  createProxyMiddleware({
    target: SERVICES.ORDER_SERVICE,
    changeOrigin: true,
    pathRewrite: {
      '^/': '/api/orders/'
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log("Proxying to ORDER SERVICE:", req.method, req.url);
    },
  })
);

module.exports = router;