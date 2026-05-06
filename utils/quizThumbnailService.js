const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

const QUIZ_THUMBNAIL_WIDTH = 1280;
const QUIZ_THUMBNAIL_HEIGHT = 720;
const QUIZ_THUMBNAIL_TRANSFORMATION = [
  {
    width: QUIZ_THUMBNAIL_WIDTH,
    height: QUIZ_THUMBNAIL_HEIGHT,
    crop: 'fill',
    gravity: 'auto',
    quality: 'auto',
    fetch_format: 'auto',
  },
];

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });

    stream.end(buffer);
  });
}

function normalizeCloudinaryError(error) {
  const message = error?.message || '';
  if (error?.http_code === 401 || /invalid signature/i.test(message)) {
    return new Error('Cloudinary rejected the upload signature. Add the real CLOUDINARY_API_SECRET from your Cloudinary dashboard to .env, then restart the server.');
  }

  return new Error(message || 'Thumbnail upload failed.');
}

async function uploadQuizThumbnail(file, quizId) {
  if (!file) return null;
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to .env.');
  }

  const folder = process.env.CLOUDINARY_QUIZ_FOLDER || 'quiz-management/quiz-thumbnails';
  let uploadResult;
  try {
    uploadResult = await uploadBuffer(file.buffer, {
      resource_type: 'image',
      asset_folder: folder,
      public_id: `quiz-${quizId}-${Date.now()}`,
      overwrite: true,
      invalidate: true,
      eager: QUIZ_THUMBNAIL_TRANSFORMATION,
      eager_async: false,
    });
  } catch (error) {
    throw normalizeCloudinaryError(error);
  }

  const thumbnailUrl = uploadResult.eager?.[0]?.secure_url || cloudinary.url(uploadResult.public_id, {
    secure: true,
    transformation: QUIZ_THUMBNAIL_TRANSFORMATION,
  });

  return {
    thumbnailUrl,
    thumbnailPublicId: uploadResult.public_id,
  };
}

async function destroyQuizThumbnail(publicId) {
  if (!publicId || !isCloudinaryConfigured()) return;

  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
    });
  } catch (error) {
    console.warn(`Failed to delete Cloudinary thumbnail ${publicId}: ${error.message}`);
  }
}

module.exports = {
  QUIZ_THUMBNAIL_WIDTH,
  QUIZ_THUMBNAIL_HEIGHT,
  uploadQuizThumbnail,
  destroyQuizThumbnail,
};
