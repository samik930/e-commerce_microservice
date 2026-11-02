const redis = require('../config/redis');

// Get cart from Redis for logged-in user
exports.getCart = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: 'User ID missing in header' });
    }

    const cart = await redis.get(`cart:${userId}`);
    res.status(200).json(cart || []);
  } catch (error) {
    console.error('Error fetching cart from Redis:', error);
    res.status(500).json({ message: 'Failed to retrieve cart' });
  }
};

// Save / sync full cart array to Redis (TTL 7 days)
exports.saveCart = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: 'User ID missing in header' });
    }

    const { items } = req.body;
    const cartItems = Array.isArray(items) ? items : [];

    // Save in Redis with 7-day TTL (604800 seconds)
    await redis.set(`cart:${userId}`, cartItems, { ex: 604800 });

    res.status(200).json({ message: 'Cart saved to Redis successfully', cart: cartItems });
  } catch (error) {
    console.error('Error saving cart to Redis:', error);
    res.status(500).json({ message: 'Failed to save cart' });
  }
};

// Clear cart from Redis
exports.clearCart = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ message: 'User ID missing in header' });
    }

    await redis.del(`cart:${userId}`);
    res.status(200).json({ message: 'Cart cleared from Redis' });
  } catch (error) {
    console.error('Error clearing cart from Redis:', error);
    res.status(500).json({ message: 'Failed to clear cart' });
  }
};
