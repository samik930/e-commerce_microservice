const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const redis = require('../config/redis');

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // 1. Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields required" });
    }

    // 2. Check if user exists
    const userResult = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    // 3. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Save user
    const newRecord = await db.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email",
      [name, email, hashedPassword]
    );

    const user = newRecord.rows[0];

    // 5. Generate JWT Token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // 🔒 Set HttpOnly Cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    res.status(201).json({
      message: "User registered successfully",
      user
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};


exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Check input
    if (!email || !password) {
      return res.status(400).json({ message: "Email & password required" });
    }

    // 2. Find user
    const userResult = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = userResult.rows[0];

    // 3. Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // 4. Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // 🔒 Set HttpOnly Cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

const getTokenFromCookie = (cookieHeader) => {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? match[1].trim() : null;
};

exports.logout = async (req, res) => {
  try {
    const token = getTokenFromCookie(req.headers.cookie);

    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.exp) {
          const now = Math.floor(Date.now() / 1000);
          const remainingTtl = Math.max(1, decoded.exp - now);
          // 🚫 Store revoked token in Redis blacklist with matching TTL
          await redis.set(`bl:${token}`, 'revoked', { ex: remainingTtl });
        }
      } catch (err) {
        console.error('Error blacklisting token:', err);
      }
    }

    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    res.json({ message: "Logged out successfully and token revoked" });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: "Logout error" });
  }
};

exports.getMe = async (req, res) => {
  try {
    const token = getTokenFromCookie(req.headers.cookie);

    if (!token) {
      return res.status(401).json({ message: "No token cookie found" });
    }

    // 🚫 Check if token is in Redis blacklist
    const isBlacklisted = await redis.get(`bl:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({ message: "Token has been revoked (logged out)" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userResult = await db.query(
      "SELECT id, name, email FROM users WHERE id = $1",
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user: userResult.rows[0] });
  } catch (error) {
    console.error("getMe error:", error.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};