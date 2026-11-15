require("dotenv").config();
const express = require("express");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();

app.use(express.json());

// Startup table check: payments
const db = require("./config/db");
db.query(`
  CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      order_id UUID NOT NULL,
      user_id UUID NOT NULL,
      amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
      currency VARCHAR(10) DEFAULT 'INR',
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      transaction_id VARCHAR(255),
      gateway_order_id VARCHAR(255),
      payment_method VARCHAR(100),
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
  CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
`).then(() => {
  console.log('✅ [Payment Service] payments table verified/ready.');
}).catch(err => {
  console.warn('⚠️ [Payment Service] payments startup check warning:', err.message);
});

// Exposed via API Gateway at /api/payments
app.use("/api/payments", paymentRoutes);

app.get("/", (req, res) => {
  res.json({
    service: "Payment Service (Mock Gateway)",
    status: "Running",
    mode: "Development Mock Gateway"
  });
});

const PORT = process.env.PORT || 5004;

app.listen(PORT, () => {
  console.log(`Payment Service running on port ${PORT}`);
});
