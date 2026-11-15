module.exports = {
    USER_SERVICE : process.env.USER_SERVICE_URL || "http://127.0.0.1:5001",
    PRODUCT_SERVICE : process.env.PRODUCT_SERVICE_URL || "http://127.0.0.1:5002",
    ORDER_SERVICE : process.env.ORDER_SERVICE_URL || "http://127.0.0.1:5003",
    PAYMENT_SERVICE : process.env.PAYMENT_SERVICE_URL || "http://127.0.0.1:5004",
    JWT_SECRET : process.env.JWT_SECRET || "mysecretkey"
}