const express = require('express');
const authController = require('../controllers/authController');
const asyncHandler = require('../utils/asyncHandler');
const { ensureAuthenticated, ensureGuest } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/register', ensureGuest, authController.showRegister);
router.post('/register', ensureGuest, asyncHandler(authController.register));
router.get('/login', ensureGuest, authController.showLogin);
router.post('/login', ensureGuest, authController.login);
router.post('/logout', authController.logout);
router.get('/teacher-pending', ensureAuthenticated, authController.showTeacherPending);

router.get('/forgot-password', ensureGuest, authController.showForgotPassword);
router.post('/forgot-password', ensureGuest, asyncHandler(authController.forgotPassword));
router.get('/reset-password/:token', ensureGuest, asyncHandler(authController.showResetPassword));
router.post('/reset-password/:token', ensureGuest, asyncHandler(authController.resetPassword));

module.exports = router;
