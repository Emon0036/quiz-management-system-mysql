const multer = require('multer');

const MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_THUMBNAIL_SIZE },
  fileFilter(req, file, callback) {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return callback(null, true);
    }

    return callback(new Error('Thumbnail must be a JPG, PNG, or WebP image.'));
  },
});

function quizThumbnailUpload(req, res, next) {
  upload.single('thumbnail')(req, res, (error) => {
    if (!error) return next();

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Thumbnail must be 5MB or smaller.'
      : error.message || 'Thumbnail upload failed.';

    req.flash('error', message);
    if (req.params.quizId) {
      return res.redirect(`/teacher/quizzes/${req.params.quizId}/edit`);
    }
    return res.redirect('/teacher/quizzes/new');
  });
}

module.exports = quizThumbnailUpload;
