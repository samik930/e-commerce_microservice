require("dotenv").config();
const express = require("express");
const productRoutes = require("./routes/productRoutes");

const app = express();

app.use(express.json());

// API Gateway proxy targets this endpoint
app.use("/api/products", productRoutes);

app.get("/", (req, res) => {
  res.send("Product Service Running...");
});

const PORT = process.env.PORT || 5002;

app.listen(PORT, () => {
  console.log(`Product Service running on port ${PORT}`);
});
