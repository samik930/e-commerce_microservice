require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");

const app = express();

// middleware
app.use(cors());
app.use(express.json());

// routes
app.use("/api/auth", authRoutes);

// health check
app.get("/", (req, res) => {
  res.send("User Service Running...");
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`User Service running on port ${PORT}`);
});