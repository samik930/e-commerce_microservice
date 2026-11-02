require("dotenv").config();
const express = require("express");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();

app.use(express.json());

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
