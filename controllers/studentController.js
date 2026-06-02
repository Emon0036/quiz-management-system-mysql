const Quiz = require('../models/Quiz');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Result = require('../models/Result');
const Leaderboard = require('../models/Leaderboard');
const Enrollment = require('../models/Enrollment');
const Progress = require('../models/Progress');
const ExamRosterEntry = require('../models/ExamRosterEntry');
const GlobalLeaderboard = require('../models/GlobalLeaderboard');
const User = require('../models/User');
const { finalizeQuizAttempt } = require('../utils/quizProgress');
const {
  buildStudentProfilePayload,
  studentProfileMessage,
} = require('../utils/profileFields');
const {
  findRosterEntryForQuiz,
  findRosterEntryForQuizByStudent,
  normalizeSection,
  normalizeStudentId,
  normalizeStudentName,
  recordRosterAttempt,
} = require('../utils/examRosterSheet');
const {
  getEnrollmentAttemptCount,
  getQuizAttemptLimit,
  hasReachedAttemptLimit,
} = require('../utils/attemptLimits');

function getAutoSubmitMessage(reason) {
  const messages = {
    clipboard_copy: 'you tried to copy during the exam',
    clipboard_copy_shortcut: 'you used a copy shortcut during the exam',
    clipboard_cut: 'you tried to cut text during the exam',
    clipboard_cut_shortcut: 'you used a cut shortcut during the exam',
    clipboard_paste: 'you tried to paste during the exam',
    clipboard_paste_shortcut: 'you used a paste shortcut during the exam',
    context_menu: 'you tried to use the right-click menu during the exam',
    dev_tools_attempted: 'developer tools were opened or attempted',
    focus_lost: 'you left the quiz tab/window',
    page_hide: 'the quiz page was hidden or closed',
    security_recovery_timeout: 'you did not return to the exam within 15 seconds',
    tab_hidden: 'you switched away from the quiz tab',
    time_up: 'time ran out',
    window_blur: 'you switched away from the quiz window',
  };

  return messages[reason] || 'the exam security rules were triggered';
}

function getStoredRosterAccess(req, quizId) {
  return req.session?.examRosterAccess?.[String(quizId)] || null;
}

function saveRosterAccess(req, quizId, entry) {
  if (!req.session) return;
  req.session.examRosterAccess = req.session.examRosterAccess || {};
  req.session.examRosterAccess[String(quizId)] = {
    entryId: String(entry._id),
    studentId: entry.studentId,
    studentName: entry.studentName || '',
    section: entry.section || '',
    studentUserId: String(entry.student || req.user?._id || req.user?.id || ''),
    verifiedAt: Date.now(),
  };
}

function getCurrentUserId(req) {
  return String(req.user?._id || req.user?.id || '');
}

async function claimRosterEntryForStudent(req, entry) {
  const userId = getCurrentUserId(req);
  if (!entry || !userId) return entry;

  let shouldSave = false;
  if (!entry.student) {
    entry.student = userId;
    shouldSave = true;
  }

  if (!entry.studentName && req.user?.name) {
    entry.studentName = normalizeStudentName(req.user.name);
    shouldSave = true;
  }

  if (shouldSave) await entry.save();
  return entry;
}

async function getVerifiedRosterEntry(req, quizId) {
  const userId = getCurrentUserId(req);
  if (!userId) return null;

  const accountVerifiedEntry = await findRosterEntryForQuizByStudent(quizId, userId);
  if (accountVerifiedEntry) {
    saveRosterAccess(req, quizId, accountVerifiedEntry);
    return accountVerifiedEntry;
  }

  const access = getStoredRosterAccess(req, quizId);
  if (!access?.studentId) return null;

  const entry = await findRosterEntryForQuiz(quizId, access.studentId, access.section);
  if (!entry || String(entry._id) !== String(access.entryId)) return null;
  if (entry.student && String(entry.student) !== userId) return null;

  await claimRosterEntryForStudent(req, entry);
  saveRosterAccess(req, quizId, entry);
  return entry;
}

async function getRosterSectionsForQuiz(quizId) {
  const entries = await ExamRosterEntry.find({ quiz: quizId });
  return Array.from(new Set(entries.map((entry) => normalizeSection(entry.section)).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

function defaultProgress() {
  return {
    totalPoints: 0,
    averageScore: 0,
    streak: 0,
    totalQuizzes: 0,
    completedQuizzes: 0,
    inProgressQuizzes: 0,
    totalAttempts: 0,
    passedQuizzes: 0,
    failedQuizzes: 0,
    badges: [],
    quizzesByCategory: [],
  };
}

function isFinalizedAttempt(attempt) {
  return attempt && attempt.status !== 'pending-review';
}

async function calculateStudentRank(leaderboard) {
  const hasPosition = Number(leaderboard?.totalPoints || 0) > 0 || Number(leaderboard?.quizzesCompleted || 0) > 0;
  if (!hasPosition) return null;
  if (Number(leaderboard.rank || 0) > 0) return Number(leaderboard.rank);

  const strongerCount = await GlobalLeaderboard.countDocuments({
    $or: [
      { totalPoints: { $gt: Number(leaderboard.totalPoints || 0) } },
      {
        totalPoints: Number(leaderboard.totalPoints || 0),
        averageScore: { $gt: Number(leaderboard.averageScore || 0) },
      },
    ],
  });
  return strongerCount + 1;
}

function buildStudentAchievements({ progress, attempts, rank, leaderboard }) {
  const finalizedAttempts = attempts.filter(isFinalizedAttempt);
  const bestAttempt = finalizedAttempts
    .slice()
    .sort((left, right) => Number(right.percentage || 0) - Number(left.percentage || 0))[0] || null;

  const achievements = [
    {
      icon: 'fa-flag-checkered',
      title: 'First step',
      detail: 'Enrolled in an exam',
      earned: Number(progress.totalQuizzes || 0) > 0,
    },
    {
      icon: 'fa-file-signature',
      title: 'Attempt maker',
      detail: `${attempts.length} submitted attempt${attempts.length === 1 ? '' : 's'}`,
      earned: attempts.length > 0,
    },
    {
      icon: 'fa-bullseye',
      title: 'Sharp score',
      detail: bestAttempt ? `Best result ${bestAttempt.percentage}%` : 'No finalized score yet',
      earned: Number(bestAttempt?.percentage || 0) >= 80,
    },
    {
      icon: 'fa-ranking-star',
      title: 'Leaderboard position',
      detail: rank ? `Global rank #${rank}` : 'Earn points to enter ranking',
      earned: Boolean(rank && rank <= 10),
    },
    {
      icon: 'fa-fire',
      title: 'Learning streak',
      detail: `${progress.streak || 0} activity streak`,
      earned: Number(progress.streak || 0) >= 3,
    },
    {
      icon: 'fa-medal',
      title: 'Badge progress',
      detail: `${leaderboard?.badge && leaderboard.badge !== 'none' ? leaderboard.badge : 'No'} global badge`,
      earned: Boolean(leaderboard?.badge && leaderboard.badge !== 'none'),
    },
  ];

  return achievements;
}

async function buildTeacherPublicProfile(teacherId) {
  const teacher = await User.findOne({
    _id: teacherId,
    role: 'teacher',
    teacherStatus: 'approved',
    accountStatus: 'active',
  });
  if (!teacher) return null;

  const quizzes = await Quiz.find({ createdBy: teacher._id, status: 'published' }).sort('-createdAt');
  const quizIds = quizzes.map((quiz) => quiz._id);
  const [totalAttempts, totalEnrollments] = await Promise.all([
    quizIds.length ? Attempt.countDocuments({ quiz: { $in: quizIds } }) : 0,
    quizIds.length ? Enrollment.countDocuments({ quiz: { $in: quizIds } }) : 0,
  ]);

  return {
    teacher,
    quizzes,
    stats: {
      publishedQuizzes: quizzes.length,
      totalAttempts,
      totalEnrollments,
    },
  };
}

exports.profile = async (req, res) => {
  const [progressDoc, leaderboardDoc, attempts, enrollments] = await Promise.all([
    Progress.findOne({ student: req.user._id }),
    GlobalLeaderboard.findOne({ student: req.user._id }),
    Attempt.find({ student: req.user._id }).populate('quiz', 'title category').sort('-submittedAt'),
    Enrollment.find({ student: req.user._id }).populate('quiz', 'title category'),
  ]);

  const progress = progressDoc || defaultProgress();
  const leaderboard = leaderboardDoc || {
    totalPoints: Number(progress.totalPoints || 0),
    averageScore: Number(progress.averageScore || 0),
    quizzesCompleted: Number(progress.completedQuizzes || 0),
    badge: 'none',
    streak: Number(progress.streak || 0),
  };
  const rank = await calculateStudentRank(leaderboard);
  const achievements = buildStudentAchievements({ progress, attempts, rank, leaderboard });

  return res.render('student/profile', {
    title: 'Student Profile',
    progress,
    leaderboard,
    rank,
    achievements,
    attempts,
    enrollments,
  });
};

exports.editProfile = async (req, res) => {
  return res.render('student/profile-edit', {
    title: 'Edit Student Profile',
  });
};

exports.updateProfile = async (req, res) => {
  const payload = buildStudentProfilePayload(req.body);
  const message = studentProfileMessage(payload);
  if (message) {
    req.flash('error', message);
    return res.redirect('/student/profile/edit');
  }

  Object.assign(req.user, payload);
  await req.user.save();
  req.flash('success', 'Profile updated successfully.');
  return res.redirect('/student/profile');
};

exports.teacherProfile = async (req, res) => {
  const profile = await buildTeacherPublicProfile(req.params.teacherId);
  if (!profile) {
    req.flash('error', 'Teacher profile is not available.');
    return res.redirect('/enrollments/my-quizzes');
  }

  return res.render('student/teacher-profile', {
    title: `${profile.teacher.name} Profile`,
    ...profile,
  });
};

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
  const [enrollment, quiz] = await Promise.all([
    Enrollment.findOne({ student: req.user._id, quiz: req.params.quizId }).populate('bestAttemptId'),
    Quiz.findOne({ _id: req.params.quizId, status: 'published' }).populate('questions'),
  ]);

  if (!enrollment) {
    req.flash('error', 'You must enroll first before attempting this exam.');
    return res.redirect('/enrollments/browse');
  }

  if (!quiz) {
    req.flash('error', 'Quiz is not available.');
    return res.redirect('/enrollments/browse');
  }

  const attemptLimit = getQuizAttemptLimit(quiz);
  if (hasReachedAttemptLimit(enrollment, quiz)) {
    req.flash('error', `You have used all ${attemptLimit} attempts for this purchase. Please purchase this quiz again to continue.`);
    return res.redirect('/enrollments/my-quizzes');
  }

  const rosterCount = await ExamRosterEntry.countDocuments({ quiz: quiz._id });
  let rosterAccess = null;
  if (rosterCount > 0) {
    const rosterEntry = await getVerifiedRosterEntry(req, quiz._id);
    if (!rosterEntry) {
      const rosterSections = await getRosterSectionsForQuiz(quiz._id);
      return res.render('student/verify-exam-id', {
        title: 'Verify Student ID',
        quiz,
        rosterSections,
      });
    }

    rosterAccess = {
      studentId: rosterEntry.studentId,
      studentName: rosterEntry.studentName || '',
      section: rosterEntry.section || '',
      entryId: rosterEntry._id,
    };
  }

  return res.render('student/take-quiz', {
    title: quiz.title,
    quiz,
    rosterAccess,
    attemptLimit,
    currentAttemptNumber: getEnrollmentAttemptCount(enrollment) + 1,
  });
};

exports.verifyExamId = async (req, res) => {
  const [enrollment, quiz] = await Promise.all([
    Enrollment.findOne({ student: req.user._id, quiz: req.params.quizId }),
    Quiz.findOne({ _id: req.params.quizId, status: 'published' }),
  ]);

  if (!enrollment) {
    req.flash('error', 'You must enroll first before attempting this exam.');
    return res.redirect('/enrollments/browse');
  }

  if (!quiz) {
    req.flash('error', 'Quiz is not available.');
    return res.redirect('/enrollments/browse');
  }

  const attemptLimit = getQuizAttemptLimit(quiz);
  if (hasReachedAttemptLimit(enrollment, quiz)) {
    req.flash('error', `You have used all ${attemptLimit} attempts for this purchase. Please purchase this quiz again to continue.`);
    return res.redirect('/enrollments/my-quizzes');
  }

  const rosterSections = await getRosterSectionsForQuiz(quiz._id);
  const requiresSection = rosterSections.length > 0;
  const studentId = normalizeStudentId(req.body.studentId);
  const section = normalizeSection(req.body.section);
  if (requiresSection && !section) {
    req.flash('error', 'Please enter your section.');
    return res.redirect(`/student/quizzes/${quiz._id}/take`);
  }

  const rosterEntry = await findRosterEntryForQuiz(quiz._id, studentId, requiresSection ? section : undefined);
  if (!rosterEntry) {
    req.flash('error', requiresSection ? 'Your Student ID and section did not match this exam sheet.' : 'You are not under this teacher or check your ID.');
    return res.redirect(`/student/quizzes/${quiz._id}/take`);
  }

  const userId = getCurrentUserId(req);
  const accountVerifiedEntry = await findRosterEntryForQuizByStudent(quiz._id, userId);
  if (accountVerifiedEntry && String(accountVerifiedEntry._id) !== String(rosterEntry._id)) {
    req.flash('error', `This account is already verified for this exam with Student ID ${accountVerifiedEntry.studentId}${accountVerifiedEntry.section ? `, Section ${accountVerifiedEntry.section}` : ''}.`);
    return res.redirect(`/student/quizzes/${quiz._id}/take`);
  }

  if (rosterEntry.student && String(rosterEntry.student) !== userId) {
    req.flash('error', 'This Student ID has already been verified by another account.');
    return res.redirect(`/student/quizzes/${quiz._id}/take`);
  }

  await claimRosterEntryForStudent(req, rosterEntry);
  saveRosterAccess(req, quiz._id, rosterEntry);
  req.flash('success', 'Student ID verified. You can start the exam now.');
  return res.redirect(`/student/quizzes/${quiz._id}/take`);
};

exports.submitQuiz = async (req, res) => {
  // Fetch the published quiz with all its questions
  const [enrollment, quiz] = await Promise.all([
    Enrollment.findOne({ student: req.user._id, quiz: req.params.quizId }),
    Quiz.findOne({ _id: req.params.quizId, status: 'published' }).populate('questions'),
  ]);

  if (!enrollment) {
    req.flash('error', 'You must enroll first before submitting this exam.');
    return res.redirect('/enrollments/browse');
  }

  if (!quiz) {
    req.flash('error', 'Quiz is not available.');
    return res.redirect('/enrollments/browse');
  }

  const attemptLimit = getQuizAttemptLimit(quiz);
  if (hasReachedAttemptLimit(enrollment, quiz)) {
    req.flash('error', `You have used all ${attemptLimit} attempts for this purchase. Please purchase this quiz again to continue.`);
    return res.redirect('/enrollments/my-quizzes');
  }

  const rosterCount = await ExamRosterEntry.countDocuments({ quiz: quiz._id });
  let rosterEntry = null;
  if (rosterCount > 0) {
    const submittedStudentId = normalizeStudentId(req.body.examRosterStudentId);
    const submittedSection = normalizeSection(req.body.examRosterSection);
    rosterEntry = await getVerifiedRosterEntry(req, quiz._id);

    if (!rosterEntry) {
      req.flash('error', 'Please verify your Student ID before starting this exam.');
      return res.redirect(`/student/quizzes/${quiz._id}/take`);
    }

    if (submittedStudentId && rosterEntry.studentId !== submittedStudentId) {
      req.flash('error', 'Your verified Student ID does not match this exam submission.');
      return res.redirect(`/student/quizzes/${quiz._id}/take`);
    }

    if (submittedSection && normalizeSection(rosterEntry.section) !== submittedSection) {
      req.flash('error', 'Your verified section does not match this exam submission.');
      return res.redirect(`/student/quizzes/${quiz._id}/take`);
    }
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
        teacherCorrectAnswer: question.correctAnswer || '',
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
        teacherCorrectAnswer: question.correctAnswer || '',
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
  const attemptNumber = (await Attempt.countDocuments({ student: req.user._id, quiz: quiz._id })) + 1;
  
  // Create an attempt record storing all answers, scores, and metadata
  const attempt = await Attempt.create({
    student: req.user._id,
    quiz: quiz._id,
    attemptNumber,
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

  enrollment.attempts = getEnrollmentAttemptCount(enrollment) + 1;
  if (!enrollment.bestAttemptId || percentage > enrollment.bestScore) {
    enrollment.bestAttemptId = attempt._id;
    enrollment.bestScore = percentage;
  }
  enrollment.status = hasManualReview ? 'pending-review' : 'completed';
  await enrollment.save();

  if (rosterEntry) {
    await recordRosterAttempt(rosterEntry, attempt);
  }

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
