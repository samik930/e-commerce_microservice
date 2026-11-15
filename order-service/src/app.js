require("dotenv").config();
const express = require("express");
const orderRoutes = require("./routes/orderRoutes");
const cartRoutes = require("./routes/cartRoutes");

const app = express();

app.use(express.json());

// Startup table check: idempotency_keys
const db = require("./config/db");
db.query(`
  CREATE TABLE IF NOT EXISTS idempotency_keys (
      key VARCHAR(255) NOT NULL,
      user_id UUID NOT NULL,
      endpoint VARCHAR(255) NOT NULL,
      response_status INT NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (key, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys(key, user_id);

  DO $$
  BEGIN
    ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE orders ALTER COLUMN status TYPE VARCHAR(50) USING status::text;
    ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'Awaiting_Payment';
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END $$;
`).then(() => {
  console.log('✅ [Order Service] idempotency_keys & orders.status verified/ready.');
}).catch(err => {
  console.warn('⚠️ [Order Service] startup migration warning:', err.message);
});

// Exposed to API Gateway
app.use("/api/orders", orderRoutes);
app.use("/api/cart", cartRoutes);

app.get("/", (req, res) => {
  res.send("Order Service Running...");
});

const PORT = process.env.PORT || 5003;

app.listen(PORT, () => {
  console.log(`Order Service running on port ${PORT}`);
});
