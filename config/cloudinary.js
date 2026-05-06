const { v2: cloudinary } = require('cloudinary');

const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD || '').trim();
const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

function isCloudinaryConfigured() {
  const isMaskedSecret = /^\*+$/.test(apiSecret);
  const isPlaceholderSecret = apiSecret.includes('replace_with') || apiSecret.includes('your_');
  return Boolean(cloudName && apiKey && apiSecret && !isMaskedSecret && !isPlaceholderSecret);
}

module.exports = {
  cloudinary,
  isCloudinaryConfigured,
};
