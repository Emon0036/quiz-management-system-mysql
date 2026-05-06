const express = require('express');
const adminController = require('../controllers/adminController');
const { ensureAdmin } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/setup', asyncHandler(adminController.showSetup));
router.post('/setup', asyncHandler(adminController.setup));

router.use(ensureAdmin);
router.get('/dashboard', asyncHandler(adminController.dashboard));
router.post('/admins', asyncHandler(adminController.createAdmin));
router.patch('/teachers/:userId/approve', asyncHandler(adminController.approveTeacher));
router.patch('/teachers/:userId/reject', asyncHandler(adminController.rejectTeacher));
router.post('/teachers/grant', asyncHandler(adminController.grantTeacherByEmail));
router.patch('/users/:userId/block', asyncHandler(adminController.blockUser));
router.patch('/users/:userId/unblock', asyncHandler(adminController.unblockUser));

module.exports = router;
