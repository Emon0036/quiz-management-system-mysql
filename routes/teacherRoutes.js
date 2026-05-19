const express = require('express');
const multer = require('multer');
const teacherController = require('../controllers/teacherController');
const asyncHandler = require('../utils/asyncHandler');
const { ensureTeacher } = require('../middleware/authMiddleware');
const quizThumbnailUpload = require('../middleware/quizThumbnailUpload');

const router = express.Router();
const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (/\.(csv|tsv|txt)$/i.test(file.originalname || '')) return callback(null, true);
    return callback(new Error('Please upload a CSV file exported from Google Sheets.'));
  },
});

router.use(ensureTeacher);
router.get('/dashboard', asyncHandler(teacherController.dashboard));
router.get('/quizzes', asyncHandler(teacherController.listQuizzes));
router.get('/quizzes/new', teacherController.showCreateQuiz);
router.post('/quizzes', quizThumbnailUpload, asyncHandler(teacherController.createQuiz));
router.get('/reviews', asyncHandler(teacherController.reviews));
router.post('/quizzes/:quizId/roster/upload', rosterUpload.single('rosterSheet'), asyncHandler(teacherController.uploadRoster));
router.get('/quizzes/:quizId/roster/download', asyncHandler(teacherController.downloadRoster));
router.get('/quizzes/:quizId/edit', asyncHandler(teacherController.showEditQuiz));
router.put('/quizzes/:quizId', quizThumbnailUpload, asyncHandler(teacherController.updateQuiz));
router.delete('/quizzes/:quizId', asyncHandler(teacherController.deleteQuiz));
router.patch('/quizzes/:quizId/publish', asyncHandler(teacherController.togglePublish));
router.post('/quizzes/:quizId/questions', asyncHandler(teacherController.addQuestion));
router.delete('/quizzes/:quizId/questions/:questionId', asyncHandler(teacherController.deleteQuestion));
router.get('/quizzes/:quizId/attempts', asyncHandler(teacherController.attempts));
router.get('/attempts/:attemptId/review', asyncHandler(teacherController.reviewAttempt));
router.patch('/attempts/:attemptId/review', asyncHandler(teacherController.updateReview));
router.get('/quizzes/:quizId/analytics', asyncHandler(teacherController.analytics));
router.get('/quizzes/:quizId/leaderboard', asyncHandler(teacherController.leaderboard));

module.exports = router;
