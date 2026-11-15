const Razorpay = require('razorpay');

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

let razorpay = null;

if (key_id && key_secret) {
  try {
    razorpay = new Razorpay({
      key_id,
      key_secret,
    });
    console.log('💳 [Razorpay] Official Razorpay client initialized with Key ID:', key_id.substring(0, 8) + '...');
  } catch (err) {
    console.error('❌ [Razorpay] Error initializing client:', err.message);
  }
} else {
  console.log('ℹ️ [Razorpay] Keys not configured. Running in Mock Sandbox mode.');
}

module.exports = razorpay;

