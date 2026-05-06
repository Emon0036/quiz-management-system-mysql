const Quiz = require('../models/Quiz');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Result = require('../models/Result');
const Leaderboard = require('../models/Leaderboard');
const Enrollment = require('../models/Enrollment');
const Progress = require('../models/Progress');
const { finalizeQuizAttempt } = require('../utils/quizProgress');

function getAutoSubmitMessage(reason) {
  const messages = {
    clipboard_copy: 'you tried to copy during the exam',
    clipboard_copy_shortcut: 'you used a copy shortcut during the exam',
    clipboard_cut: 'you tried to cut text during the exam',
    clipboard_cut_shortcut: 'you used a cut shortcut during the exam',
    clipboard_paste: 'you tried to paste during the exam',
    clipboard_paste_shortcut: 'you used a paste shortcut during the exam',
    dev_tools_attempted: 'developer tools were opened or attempted',
    focus_lost: 'you left the quiz tab/window',
    page_hide: 'the quiz page was hidden or closed',
    tab_hidden: 'you switched away from the quiz tab',
    time_up: 'time ran out',
    window_blur: 'you switched away from the quiz window',
  };

  return messages[reason] || 'the exam security rules were triggered';
}

exports.dashboard = async (req, res) => {
  const [recentAttempts, availableQuizCount, completedCount, enrollments, progress, pendingReviewCount] = await Promise.all([
    Attempt.find({ student: req.user._id }).populate('quiz', 'title category examType').sort('-submittedAt').limit(5),
    Quiz.countDocuments({ status: 'published' }),
    Attempt.countDocuments({ student: req.user._id }),
    Enrollment.find({ student: req.user._id }).populate('quiz', 'examType').select('status quiz'),
    Progress.findOne({ student: req.user._id }).select(
      'totalPoints averageScore streak totalQuizzes completedQuizzes inProgressQuizzes totalAttempts passedQuizzes failedQuizzes'
    ),
    Attempt.countDocuments({ student: req.user._id, status: 'pending-review' }),
  ]);

  const examTypeCounts = { quiz: 0, 'true-false': 0, 'short-answer': 0, 'coding-test': 0 };
  enrollments.forEach((enrollment) => {
    const examType = enrollment.quiz?.examType || 'quiz';
    if (examTypeCounts[examType] !== undefined) examTypeCounts[examType] += 1;
  });

  res.render('student/dashboard', {
    title: 'Student Dashboard',
    recentAttempts,
    stats: { availableQuizCount, completedCount, enrolledCount: enrollments.length, pendingReviewCount },
    examTypeCounts,
    progress: progress || {
      totalPoints: 0,
      averageScore: 0,
      streak: 0,
      totalQuizzes: 0,
      completedQuizzes: 0,
      inProgressQuizzes: 0,
      totalAttempts: 0,
      passedQuizzes: 0,
      failedQuizzes: 0,
    },
  });
};

exports.quizList = async (req, res) => {
  return res.redirect('/enrollments/browse');
};

exports.takeQuiz = async (req, res) => {
  const enrollment = await Enrollment.findOne({ student: req.user._id, quiz: req.params.quizId }).populate('bestAttemptId');
  if (!enrollment) {
    req.flash('error', 'You must enroll first before attempting this exam.');
    return res.redirect('/enrollments/browse');
  }

  const quiz = await Quiz.findOne({ _id: req.params.quizId, status: 'published' }).populate('questions');
  if (!quiz) {
    req.flash('error', 'Quiz is not available.');
    return res.redirect('/enrollments/browse');
  }
  return res.render('student/take-quiz', { title: quiz.title, quiz });
};

exports.submitQuiz = async (req, res) => {
  // Fetch the published quiz with all its questions
  const enrollment = await Enrollment.findOne({ student: req.user._id, quiz: req.params.quizId });
  if (!enrollment) {
    req.flash('error', 'You must enroll first before submitting this exam.');
    return res.redirect('/enrollments/browse');
  }

  const quiz = await Quiz.findOne({ _id: req.params.quizId, status: 'published' }).populate('questions');
  if (!quiz) {
    req.flash('error', 'Quiz is not available.');
    return res.redirect('/enrollments/browse');
  }

  const submittedAnswers = req.body.answers || {};
  const submittedCode = req.body.code || {};
  let score = 0;
  let hasManualReview = false;
  let hasCodingQuestions = false;

  // Process each question and grade the answer
  const answers = quiz.questions.map((question) => {
    const answer = String(submittedAnswers[question._id] || '').trim();
    const code = String(submittedCode[question._id] || '').trim();

    // Coding questions require execution/review
    if (question.type === 'coding') {
      hasCodingQuestions = true;
      hasManualReview = true;
      return {
        question: question._id,
        answer: code,
        needsManualReview: true,
        marksObtained: 0,
        isCorrect: false,
      };
    }

    // Short answer questions require teacher review - mark for manual review
    if (question.type === 'short-answer') {
      hasManualReview = true;
      return {
        question: question._id,
        answer,
        needsManualReview: true,
        marksObtained: 0,
        isCorrect: false,
      };
    }

    // For multiple choice and true/false, auto-grade the answer
    const isCorrect = question.checkAnswer(answer);
    const marksObtained = isCorrect ? question.marks : 0;
    score += marksObtained;
    return { question: question._id, answer, isCorrect, marksObtained, needsManualReview: false };
  });

  // Calculate percentage score
  const percentage = quiz.totalMarks ? Math.round((score / quiz.totalMarks) * 100) : 0;
  
  // Create an attempt record storing all answers, scores, and metadata
  const attempt = await Attempt.create({
    student: req.user._id,
    quiz: quiz._id,
    answers,
    score,
    totalMarks: quiz.totalMarks,
    percentage,
    status: hasManualReview ? 'pending-review' : 'submitted',
    passed: !hasManualReview && percentage >= quiz.passingMarks,
    timeSpent: Number(req.body.timeSpent || 0),
    autoSubmitted: String(req.body.autoSubmitted || '') === '1',
    autoSubmitReason: String(req.body.autoSubmitReason || ''),
    submittedAt: new Date(),
  });

  // Create result record for tracking overall performance
  await Result.create({
    student: req.user._id,
    quiz: quiz._id,
    attempt: attempt._id,
    marksObtained: score,
    totalMarks: quiz.totalMarks,
    percentage,
    status: hasManualReview ? 'pending-review' : percentage >= quiz.passingMarks ? 'pass' : 'fail',
  });

  // Update leaderboard if all answers are auto-graded
  if (!hasManualReview) {
    const leaderboard = await Leaderboard.findOneAndUpdate(
      { quiz: quiz._id },
      { $setOnInsert: { quiz: quiz._id } },
      { upsert: true, returnDocument: 'after' }
    );
    await leaderboard.recordAttempt(req.user._id, score, percentage);
  }

  enrollment.attempts += 1;
  if (!enrollment.bestAttemptId || percentage > enrollment.bestScore) {
    enrollment.bestAttemptId = attempt._id;
    enrollment.bestScore = percentage;
  }
  enrollment.status = hasManualReview ? 'pending-review' : 'completed';
  await enrollment.save();

  const autoSubmitMessage = getAutoSubmitMessage(attempt.autoSubmitReason);

  if (!hasManualReview) {
    const { pointsEarned } = await finalizeQuizAttempt(attempt._id);
    if (attempt.autoSubmitted) {
      req.flash('error', `Quiz auto-submitted because ${autoSubmitMessage}. Points earned: +${pointsEarned}.`);
    } else {
      req.flash('success', `Quiz submitted successfully. Points earned: +${pointsEarned}.`);
    }
  } else {
    if (attempt.autoSubmitted) {
      req.flash('error', `Exam auto-submitted because ${autoSubmitMessage}. Answers are waiting for teacher review.`);
    } else if (hasCodingQuestions) {
      req.flash('success', 'Exam submitted. Coding submissions are being evaluated.');
    } else {
      req.flash('success', 'Quiz submitted. Answers are waiting for teacher review.');
    }
  }
  return res.redirect(`/student/results/${attempt._id}`);
};

// Fetch student's specific quiz attempt and populate the question data needed for result review.
exports.result = async (req, res) => {
  const attempt = await Attempt.findOne({ _id: req.params.attemptId, student: req.user._id })
    .populate('quiz')
    .populate({
      path: 'answers.question',
      select: 'questionText type options correctAnswer explanation marks'
    });
  
  if (!attempt) {
    req.flash('error', 'Result not found.');
    return res.redirect('/student/history');
  }
  
  return res.render('student/result', { title: 'Quiz Result', attempt });
};

exports.history = async (req, res) => {
  const attempts = await Attempt.find({ student: req.user._id }).populate('quiz', 'title category passingMarks').sort('-submittedAt');
  res.render('student/history', { title: 'Score History', attempts });
};

exports.reviews = async (req, res) => {
  const reviewAttempts = await Attempt.find({
    student: req.user._id,
    status: { $in: ['pending-review', 'reviewed'] },
  })
    .populate('quiz', 'title category duration totalMarks passingMarks')
    .sort('-submittedAt');

  res.render('student/reviews', {
    title: 'Review Center',
    reviewAttempts,
  });
};

exports.leaderboard = async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.quizId, status: 'published' });
  if (!quiz) {
    req.flash('error', 'Quiz is not available.');
    return res.redirect('/student/quizzes');
  }
  const leaderboard = await Leaderboard.findOne({ quiz: quiz._id }).populate('entries.student', 'name email profileImage');
  const myEntry = leaderboard?.entries.find((entry) => entry.student._id.toString() === req.user._id.toString());
  res.render('student/leaderboard', { title: 'Leaderboard', quiz, leaderboard, myEntry });
};
