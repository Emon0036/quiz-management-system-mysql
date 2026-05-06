const Submission = require("../models/Submission");
const Problem = require("../models/Problem");

function canReviewProblem(req, problem) {
  if (!problem) return false;
  if (req.user?.role === 'admin') return true;
  return String(problem.createdBy || '') === String(req.user?._id);
}

/**
 * Submit code for manual teacher review
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
exports.submitCode = async (req, res) => {
  try {
    // Extract code, language, and problem ID from request body
    const { code, language, problemId } = req.body;

    // Validate required fields
    if (!code || !language || !problemId) {
      return res.status(400).json({
        error: 'Code, language, and problemId are required',
      });
    }

    // Fetch the problem from database
    const problem = await Problem.findById(problemId);
    if (!problem) {
      return res.status(404).json({
        error: 'Problem not found',
      });
    }

    // Save submission to database for manual review
    const submission = await Submission.create({
      problem: problemId,
      student: req.user._id,
      code,
      language,
    });

    // Return submission info
    res.json({
      success: true,
      status: submission.status,
      submissionId: submission._id,
      message: 'Submitted for teacher review.',
    });
  } catch (error) {
    // Log error and return error response
    console.error('Code submission error:', error.message);
    res.status(500).json({
      error: 'Failed to submit code',
      details: error.message,
    });
  }
};

/**
 * Get submission history for current user
 * Lists all code submissions made by the logged-in user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
exports.history = async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    // Fetch submissions for current user, sorted by newest first
    const submissions = await Submission.find({ student: req.user._id })
      .populate('problem', 'title') // Include problem title
      .sort('-submittedAt') // Sort by newest first
      .limit(50); // Limit to last 50 submissions

    // Return submissions
    res.json({
      success: true,
      submissions,
    });
  } catch (error) {
    // Log error and return error response
    console.error('Error fetching submission history:', error.message);
    res.status(500).json({
      error: 'Failed to fetch submission history',
      details: error.message,
    });
  }
};

/**
 * Get all code submissions for a problem (teacher view)
 */
exports.getProblemSubmissions = async (req, res) => {
  try {
    const problemId = req.params.problemId;
    const problem = await Problem.findById(problemId);
    
    if (!problem) {
      req.flash('error', 'Problem not found');
      return res.redirect('/problems');
    }
    if (!canReviewProblem(req, problem)) {
      req.flash('error', 'You can only review submissions for problems you created.');
      return res.redirect('/problems/manage');
    }

    const submissions = await Submission.find({ problem: problemId })
      .populate('student', 'name email')
      .populate('reviewedBy', 'name')
      .sort('-submittedAt');

    res.render('teacher/submissions', {
      title: `Submissions for ${problem.title}`,
      problem,
      submissions
    });
  } catch (error) {
    console.error('Error fetching submissions:', error.message);
    req.flash('error', 'Failed to load submissions');
    res.redirect('/problems');
  }
};

/**
 * View single submission for reviewing (teacher view)
 */
exports.viewSubmission = async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.submissionId)
      .populate('problem')
      .populate('student', 'name email')
      .populate('reviewedBy', 'name');

    if (!submission) {
      req.flash('error', 'Submission not found');
      return res.redirect('/problems');
    }
    if (!canReviewProblem(req, submission.problem)) {
      req.flash('error', 'You can only review submissions for problems you created.');
      return res.redirect('/problems/manage');
    }

    res.render('teacher/review-submission', {
      title: 'Review Code Submission',
      submission
    });
  } catch (error) {
    console.error('Error fetching submission:', error.message);
    req.flash('error', 'Failed to load submission');
    res.redirect('/problems');
  }
};

/**
 * Update submission with teacher feedback and marks
 */
exports.updateSubmission = async (req, res) => {
  try {
    const { marksAwarded, teacherComment, correctedCode } = req.body;
    const submissionId = req.params.submissionId;

    const submission = await Submission.findById(submissionId).populate('problem');
    if (!submission) {
      req.flash('error', 'Submission not found');
      return res.redirect('/problems');
    }
    if (!canReviewProblem(req, submission.problem)) {
      req.flash('error', 'You can only review submissions for problems you created.');
      return res.redirect('/problems/manage');
    }

    // Update submission with teacher review
    submission.marksAwarded = Number(marksAwarded) || 0;
    submission.teacherComment = teacherComment || '';
    submission.correctedCode = correctedCode || '';
    submission.reviewedBy = req.user._id;
    submission.reviewedAt = new Date();
    submission.status = 'reviewed';

    await submission.save();

    req.flash('success', 'Submission reviewed and marks assigned');
    res.redirect(`/problems/${submission.problem._id || submission.problem}`);
  } catch (error) {
    console.error('Error updating submission:', error.message);
    req.flash('error', 'Failed to update submission');
    res.redirect('/problems');
  }
};

/**
 * View submission as student (to see teacher feedback)
 */
exports.viewStudentSubmission = async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.submissionId)
      .populate('problem')
      .populate('student', 'name email')
      .populate('reviewedBy', 'name');

    if (!submission) {
      req.flash('error', 'Submission not found');
      return res.redirect('/problems');
    }

    // Ensure student can only view their own submission
    if (submission.student._id.toString() !== req.user._id.toString()) {
      req.flash('error', 'You can only view your own submissions');
      return res.redirect('/problems');
    }

    res.render('student/submission-view', {
      title: 'My Submission',
      submission
    });
  } catch (error) {
    console.error('Error fetching submission:', error.message);
    req.flash('error', 'Failed to load submission');
    res.redirect('/problems');
  }
};
