require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const proxyRoutes = require("./routes/proxyRoutes");

const app = express();
app.use(cookieParser());


const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:3000"
];

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id", "idempotency-key", "Idempotency-Key"],
    credentials: true,
  })
);

app.use((req, res, next) => {
  const instance = process.env.GATEWAY_INSTANCE || "gateway-primary";
  res.setHeader("X-Gateway-Instance", instance);
  console.log(`[${instance}] Incoming Request:`, req.method, req.url);
  next();
});

// routes
app.use("/api", proxyRoutes);

// health check
app.get("/", (req, res) => {
  res.send("API Gateway Running...");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});