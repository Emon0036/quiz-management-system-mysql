const express = require('express');
const studentController = require('../controllers/studentController');
const asyncHandler = require('../utils/asyncHandler');
const { ensureStudent } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(ensureStudent);
router.get('/dashboard', asyncHandler(studentController.dashboard));
router.get('/quizzes', asyncHandler(studentController.quizList));
router.get('/progress', (req, res) => res.redirect('/enrollments/progress'));
router.get('/leaderboard', (req, res) => res.redirect('/enrollments/leaderboard'));
router.get('/quizzes/:quizId/take', asyncHandler(studentController.takeQuiz));
router.post('/quizzes/:quizId/submit', asyncHandler(studentController.submitQuiz));
router.get('/results/:attemptId', asyncHandler(studentController.result));
router.get('/history', asyncHandler(studentController.history));
router.get('/reviews', asyncHandler(studentController.reviews));
router.get('/quizzes/:quizId/leaderboard', asyncHandler(studentController.leaderboard));

module.exports = router;
