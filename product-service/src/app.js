require("dotenv").config();
const express = require("express");
const productRoutes = require("./routes/productRoutes");

const app = express();

app.use(express.json());

// Startup table check: processed_events (Idempotent Consumer)
const db = require("./config/db");
db.query(`
  CREATE TABLE IF NOT EXISTS processed_events (
      event_id VARCHAR(255) NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      consumer_service VARCHAR(100) NOT NULL,
      response_payload JSONB,
      processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (event_id, consumer_service)
  );
  CREATE INDEX IF NOT EXISTS idx_processed_events_lookup ON processed_events(event_id, consumer_service);
`).then(() => {
  console.log('✅ [Product Service] processed_events table verified/ready.');
}).catch(err => {
  console.warn('⚠️ [Product Service] processed_events startup check warning:', err.message);
});

// API Gateway proxy targets this endpoint
app.use("/api/products", productRoutes);

app.get("/", (req, res) => {
  res.send("Product Service Running...");
});

const PORT = process.env.PORT || 5002;

app.listen(PORT, () => {
  console.log(`Product Service running on port ${PORT}`);
});
