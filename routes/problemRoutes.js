const express = require("express");
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { ensureAdminOrTeacher } = require('../middleware/authMiddleware');
const problemController = require("../controllers/problemController");

// Staff-only routes (admins + approved teachers)

// Show problem management dashboard
router.get("/manage", ensureAdminOrTeacher, asyncHandler(problemController.manageProblem));
router.get("/manage/dashboard", ensureAdminOrTeacher, asyncHandler(problemController.manageProblem));

// Show problem creation form
router.get("/create/new", ensureAdminOrTeacher, asyncHandler(problemController.showCreateProblem));

// Create a new problem
router.post("/create", ensureAdminOrTeacher, asyncHandler(problemController.createProblem));

// Show problem edit form
router.get("/:id/edit", ensureAdminOrTeacher, asyncHandler(problemController.showEditProblem));

// Update problem
router.put("/:id/edit", ensureAdminOrTeacher, asyncHandler(problemController.updateProblem));

// Alternative POST method for edit (for form compatibility)
router.post("/:id/edit", ensureAdminOrTeacher, asyncHandler(problemController.updateProblem));

// Delete problem
router.delete("/:id", ensureAdminOrTeacher, asyncHandler(problemController.deleteProblem));

// Public routes - no authentication required
// Get all problems - public view for students
router.get("/", asyncHandler(problemController.getAllProblems));

// Get single problem by ID - public view for code editor
router.get("/:id", asyncHandler(problemController.getSingleProblem));

module.exports = router;
