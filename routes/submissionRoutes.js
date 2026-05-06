const express = require("express");
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { ensureAuthenticatedApi, ensureAdminOrTeacher, ensureAuthenticated } = require('../middleware/authMiddleware');
const submissionController = require("../controllers/submissionController");

// Student routes - submit code and view history
router.post("/submit", ensureAuthenticatedApi, asyncHandler(submissionController.submitCode));
router.get("/history", ensureAuthenticatedApi, asyncHandler(submissionController.history));
router.get("/:submissionId/view", ensureAuthenticated, asyncHandler(submissionController.viewStudentSubmission));

// Teacher routes - view and review submissions
router.get("/problem/:problemId", ensureAdminOrTeacher, asyncHandler(submissionController.getProblemSubmissions));
router.get("/:submissionId/review", ensureAdminOrTeacher, asyncHandler(submissionController.viewSubmission));
router.patch("/:submissionId/review", ensureAdminOrTeacher, asyncHandler(submissionController.updateSubmission));

module.exports = router;
