const cloudinary = require('cloudinary').v2;

const isConfigured = () => {
  if (process.env.CLOUDINARY_URL && process.env.CLOUDINARY_URL.trim() !== '') {
    return true;
  }
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_CLOUD_NAME.trim() !== '' &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_KEY.trim() !== '' &&
    process.env.CLOUDINARY_API_SECRET &&
    process.env.CLOUDINARY_API_SECRET.trim() !== ''
  );
};

const configureCloudinary = () => {
  if (process.env.CLOUDINARY_URL && process.env.CLOUDINARY_URL.trim() !== '') {
    cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL.trim() });
    return true;
  }
  if (isConfigured()) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
      api_key: process.env.CLOUDINARY_API_KEY.trim(),
      api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
      secure: true
    });
    return true;
  }
  return false;
};

// Initial config check
if (configureCloudinary()) {
  console.log('☁️ [Cloudinary] Initialized successfully.');
} else {
  console.log('ℹ️ [Cloudinary] Credentials not set in environment. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to enable live uploads.');
}

/**
 * Upload a file buffer to Cloudinary using upload_stream
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {string} folder - Target folder in Cloudinary
 * @returns {Promise<Object>} Cloudinary upload result
 */
const uploadToCloudinary = (buffer, folder = 'microservice-products') => {
  return new Promise((resolve, reject) => {
    if (!configureCloudinary()) {
      return reject(new Error('Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are not configured.'));
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        transformation: [
          { width: 800, height: 800, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
};

module.exports = {
  cloudinary,
  isConfigured,
  uploadToCloudinary
};

