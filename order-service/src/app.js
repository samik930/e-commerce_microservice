require("dotenv").config();
const express = require("express");
const orderRoutes = require("./routes/orderRoutes");
const cartRoutes = require("./routes/cartRoutes");

const app = express();

app.use(express.json());

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
