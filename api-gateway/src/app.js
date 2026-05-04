require("dotenv").config();

const express = require("express");
const cors = require("cors");

const proxyRoutes = require("./routes/proxyRoutes");

const app = express();

//CORS (this is enough)
app.use(
  cors({
    origin: "http://localhost:5174",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use((req, res, next) => {
  console.log("Incoming Request:", req.method, req.url);
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