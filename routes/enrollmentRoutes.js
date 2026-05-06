const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { ensureStudent } = require('../middleware/authMiddleware');
const enrollmentController = require('../controllers/enrollmentController');

// Student routes - enrollment and progress
router.get('/browse', ensureStudent, asyncHandler(enrollmentController.browseQuizzes));
router.post('/:quizId/enroll', ensureStudent, asyncHandler(enrollmentController.enrollQuiz));
router.get('/my-quizzes', ensureStudent, asyncHandler(enrollmentController.getEnrolledQuizzes));
router.get('/progress', ensureStudent, asyncHandler(enrollmentController.getProgress));
router.get('/leaderboard', ensureStudent, asyncHandler(enrollmentController.getLeaderboard));

module.exports = router;
