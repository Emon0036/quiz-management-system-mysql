const multer = require('multer');

const MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024;
const MAX_ROSTER_SIZE = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_ROSTER_EXTENSIONS = /\.(csv|tsv|txt)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(MAX_THUMBNAIL_SIZE, MAX_ROSTER_SIZE) },
  fileFilter(req, file, callback) {
    if (file.fieldname === 'thumbnail' && ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return callback(null, true);
    }

    if (file.fieldname === 'rosterSheet' && ALLOWED_ROSTER_EXTENSIONS.test(file.originalname || '')) {
      return callback(null, true);
    }

    if (file.fieldname === 'rosterSheet') {
      return callback(new Error('Student sheet must be a CSV file exported from Google Sheets.'));
    }

    return callback(new Error('Thumbnail must be a JPG, PNG, or WebP image.'));
  },
});

function quizThumbnailUpload(req, res, next) {
  upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'rosterSheet', maxCount: 1 },
  ])(req, res, (error) => {
    if (!error) return next();

    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded files must be 5MB or smaller.'
      : error.message || 'Thumbnail upload failed.';

    req.flash('error', message);
    if (req.params.quizId) {
      return res.redirect(`/teacher/quizzes/${req.params.quizId}/edit`);
    }
    return res.redirect('/teacher/quizzes/new');
  });
}

module.exports = quizThumbnailUpload;
