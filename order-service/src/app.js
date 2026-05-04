require("dotenv").config();
const express = require("express");
const cors = require("cors");
const orderRoutes = require("./routes/orderRoutes");

const app = express();

app.use(cors());
app.use(express.json());

// Exposed to API Gateway
app.use("/api/orders", orderRoutes);

app.get("/", (req, res) => {
  res.send("Order Service Running...");
});

const PORT = process.env.PORT || 5003;

app.listen(PORT, () => {
  console.log(`Order Service running on port ${PORT}`);
});
