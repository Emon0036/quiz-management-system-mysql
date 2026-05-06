const Quiz = require('../models/Quiz');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Result = require('../models/Result');
const Leaderboard = require('../models/Leaderboard');
const Enrollment = require('../models/Enrollment');
const { finalizeQuizAttempt } = require('../utils/quizProgress');
const { uploadQuizThumbnail, destroyQuizThumbnail } = require('../utils/quizThumbnailService');

const EXAM_TYPES = ['quiz', 'true-false', 'short-answer', 'coding-test'];
const DIFFICULTY_LEVELS = ['Easy', 'Medium', 'Hard'];
const QUESTION_TYPES_BY_EXAM = {
  quiz: ['multiple-choice', 'true-false', 'short-answer'],
  'true-false': ['true-false'],
  'short-answer': ['short-answer'],
  'coding-test': ['coding'],
};
const CODING_LANGUAGES = ['javascript', 'python', 'java', 'cpp', 'csharp'];

async function getTeacherQuiz(quizId, teacherId) {
  return Quiz.findOne({ _id: quizId, createdBy: teacherId }).populate('questions');
}

function cleanText(value) {
  return String(value || '').trim();
}

function buildQuizPayload(body) {
  const duration = Number(body.duration);
  const passingMarks = Number(body.passingMarks);
  const payload = {
    examType: EXAM_TYPES.includes(body.examType) ? body.examType : 'quiz',
    title: cleanText(body.title),
    description: cleanText(body.description),
    category: cleanText(body.category) || 'General Knowledge',
    difficulty: DIFFICULTY_LEVELS.includes(body.difficulty) ? body.difficulty : 'Medium',
    duration,
    passingMarks,
  };

  const errors = [];
  if (!payload.title) errors.push('Quiz title is required.');
  if (!Number.isFinite(duration) || duration < 1) errors.push('Duration must be at least 1 minute.');
  if (!Number.isFinite(passingMarks) || passingMarks < 0 || passingMarks > 100) {
    errors.push('Passing percentage must be between 0 and 100.');
  }

  return { payload, errors };
}

function allowedQuestionTypesForQuiz(quiz) {
  return QUESTION_TYPES_BY_EXAM[quiz.examType || 'quiz'] || QUESTION_TYPES_BY_EXAM.quiz;
}

function normalizeOptionList(options) {
  const values = Array.isArray(options) ? options : [options];
  return values.map(cleanText).filter(Boolean);
}

function normalizeTrueFalseAnswer(answer) {
  const value = cleanText(answer).toLowerCase();
  if (value === 'true') return 'True';
  if (value === 'false') return 'False';
  return '';
}

function parseCodingTestCases(body) {
  const inputs = Array.isArray(body.testCaseInputs) ? body.testCaseInputs : [body.testCaseInputs || ''];
  const outputs = Array.isArray(body.testCaseOutputs) ? body.testCaseOutputs : [body.testCaseOutputs || ''];

  return inputs
    .map((input, index) => ({
      input: cleanText(input),
      expectedOutput: cleanText(outputs[index]),
    }))
    .filter((testCase) => testCase.input || testCase.expectedOutput);
}

function buildQuestionPayload(quiz, body) {
  const type = cleanText(body.type);
  const allowedTypes = allowedQuestionTypesForQuiz(quiz);
  const marks = Number(body.marks || 1);
  const payload = {
    quiz: quiz._id,
    questionText: cleanText(body.questionText),
    type,
    explanation: '',
    marks,
  };
  const errors = [];

  if (!payload.questionText) errors.push('Question text is required.');
  if (!allowedTypes.includes(type)) {
    errors.push('That question type is not allowed for this exam type.');
  }
  if (!Number.isFinite(marks) || marks < 1) errors.push('Question marks must be at least 1.');

  if (type === 'multiple-choice') {
    const options = normalizeOptionList(body.options);
    const correctAnswer = cleanText(body.correctAnswer);
    if (options.length < 2) errors.push('Multiple choice questions need at least two options.');
    if (!correctAnswer) errors.push('Choose or enter the correct option.');
    if (correctAnswer && options.length && !options.some((option) => option.toLowerCase() === correctAnswer.toLowerCase())) {
      errors.push('Correct answer must match one of the options.');
    }
    payload.options = options;
    payload.correctAnswer = correctAnswer;
    payload.explanation = cleanText(body.explanation);
  } else if (type === 'true-false') {
    const correctAnswer = normalizeTrueFalseAnswer(body.correctAnswer);
    if (!correctAnswer) errors.push('True/False questions require True or False as the correct answer.');
    payload.options = ['True', 'False'];
    payload.correctAnswer = correctAnswer;
    payload.explanation = cleanText(body.explanation);
  } else if (type === 'short-answer') {
    payload.options = [];
    payload.correctAnswer = '';
  } else if (type === 'coding') {
    const testCases = parseCodingTestCases(body);
    payload.language = cleanText(body.language);
    if (!payload.language) errors.push('Programming language is required for coding questions.');
    payload.codeTemplate = cleanText(body.codeTemplate);
    payload.testCases = testCases;
  }

  return { payload, errors };
}

function calculateGrade(percentage) {
  if (percentage >= 90) return 'A';
  if (percentage >= 80) return 'B';
  if (percentage >= 70) return 'C';
  if (percentage >= 60) return 'D';
  return 'F';
}

async function recalculateQuizMarks(quizId) {
  const questions = await Question.find({ quiz: quizId });
  const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);
  await Quiz.findByIdAndUpdate(quizId, { questions: questions.map((question) => question._id), totalMarks });
}

exports.dashboard = async (req, res) => {
  const quizzes = await Quiz.find({ createdBy: req.user._id }).sort('-createdAt');
  const quizIds = quizzes.map((quiz) => quiz._id);
  const totalAttempts = await Attempt.countDocuments({ quiz: { $in: quizIds } });
  const pendingReviews = await Attempt.countDocuments({ quiz: { $in: quizIds }, status: 'pending-review' });
  const enrollmentStats = quizIds.length
    ? await Enrollment.aggregate([
        { $match: { quiz: { $in: quizIds } } },
        {
          $group: {
            _id: '$quiz',
            enrolledCount: { $sum: 1 },
            completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          },
        },
      ])
    : [];
  const statsByQuiz = new Map(enrollmentStats.map((item) => [String(item._id), item]));
  quizzes.forEach((quiz) => {
    const stat = statsByQuiz.get(String(quiz._id));
    quiz.enrolledCount = stat?.enrolledCount || 0;
    quiz.completedCount = stat?.completedCount || 0;
  });

  res.render('teacher/dashboard', {
    title: 'Teacher Dashboard',
    quizzes,
    stats: {
      totalQuizzes: quizzes.length,
      publishedQuizzes: quizzes.filter((quiz) => quiz.status === 'published').length,
      draftQuizzes: quizzes.filter((quiz) => quiz.status === 'draft').length,
      totalAttempts,
      pendingReviews,
    },
  });
};

exports.listQuizzes = async (req, res) => {
  const quizzes = await Quiz.find({ createdBy: req.user._id }).sort('-createdAt');
  const quizIds = quizzes.map((quiz) => quiz._id);
  const enrollmentStats = quizIds.length
    ? await Enrollment.aggregate([
        { $match: { quiz: { $in: quizIds } } },
        {
          $group: {
            _id: '$quiz',
            enrolledCount: { $sum: 1 },
            completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          },
        },
      ])
    : [];
  const statsByQuiz = new Map(enrollmentStats.map((item) => [String(item._id), item]));
  quizzes.forEach((quiz) => {
    const stat = statsByQuiz.get(String(quiz._id));
    quiz.enrolledCount = stat?.enrolledCount || 0;
    quiz.completedCount = stat?.completedCount || 0;
  });
  res.render('teacher/quizzes', { title: 'Manage Quizzes', quizzes });
};

exports.showCreateQuiz = (req, res) => res.render('teacher/quiz-form', { title: 'Create Quiz', quiz: {}, questions: [], action: '/teacher/quizzes' });

exports.createQuiz = async (req, res) => {
  const { payload, errors } = buildQuizPayload(req.body);
  if (errors.length) {
    req.flash('error', errors[0]);
    return res.redirect('/teacher/quizzes/new');
  }

  let thumbnailPayload = {};
  if (req.file) {
    try {
      thumbnailPayload = await uploadQuizThumbnail(req.file, 'new');
    } catch (error) {
      req.flash('error', error.message || 'Thumbnail upload failed.');
      return res.redirect('/teacher/quizzes/new');
    }
  }

  const quiz = await Quiz.create({ ...payload, ...thumbnailPayload, createdBy: req.user._id, status: 'draft' });
  await Leaderboard.create({ quiz: quiz._id, entries: [] });
  req.flash('success', 'Quiz created. Add questions next.');
  return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
};

exports.showEditQuiz = async (req, res) => {
  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }
  return res.render('teacher/quiz-form', { title: 'Edit Quiz', quiz, questions: quiz.questions, action: `/teacher/quizzes/${quiz._id}?_method=PUT` });
};

exports.updateQuiz = async (req, res) => {
  const { payload, errors } = buildQuizPayload(req.body);
  if (errors.length) {
    req.flash('error', errors[0]);
    return res.redirect(`/teacher/quizzes/${req.params.quizId}/edit`);
  }

  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }

  const allowedTypes = QUESTION_TYPES_BY_EXAM[payload.examType] || QUESTION_TYPES_BY_EXAM.quiz;
  const hasInvalidExistingQuestion = quiz.questions.some((question) => !allowedTypes.includes(question.type));
  if (hasInvalidExistingQuestion) {
    req.flash('error', 'Remove incompatible questions before changing this exam type.');
    return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
  }

  if (req.file) {
    let thumbnailPayload = {};
    try {
      thumbnailPayload = await uploadQuizThumbnail(req.file, quiz._id);
    } catch (error) {
      req.flash('error', error.message || 'Thumbnail upload failed.');
      return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
    }

    await destroyQuizThumbnail(quiz.thumbnailPublicId);
    Object.assign(quiz, thumbnailPayload);
  }

  Object.assign(quiz, payload);
  await quiz.save();
  req.flash('success', 'Quiz details updated.');
  return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
};

exports.deleteQuiz = async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.quizId, createdBy: req.user._id });
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }
  await Promise.all([
    destroyQuizThumbnail(quiz.thumbnailPublicId),
    Question.deleteMany({ quiz: quiz._id }),
    Attempt.deleteMany({ quiz: quiz._id }),
    Result.deleteMany({ quiz: quiz._id }),
    Leaderboard.deleteOne({ quiz: quiz._id }),
    Quiz.deleteOne({ _id: quiz._id }),
  ]);
  req.flash('success', 'Quiz deleted.');
  return res.redirect('/teacher/quizzes');
};

exports.togglePublish = async (req, res) => {
  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }
  if (quiz.status === 'draft' && quiz.questions.length === 0) {
    req.flash('error', 'Add at least one question before publishing.');
    return res.redirect('/teacher/quizzes');
  }
  const allowedTypes = allowedQuestionTypesForQuiz(quiz);
  if (quiz.status === 'draft' && quiz.questions.some((question) => !allowedTypes.includes(question.type))) {
    req.flash('error', 'This quiz has questions that do not match its exam type.');
    return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
  }
  quiz.status = quiz.status === 'published' ? 'draft' : 'published';
  await quiz.save();
  req.flash('success', `Quiz ${quiz.status === 'published' ? 'published' : 'unpublished'}.`);
  return res.redirect('/teacher/quizzes');
};

exports.addQuestion = async (req, res) => {
  // Verify the quiz exists and belongs to the current teacher
  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }

  const { payload: questionData, errors } = buildQuestionPayload(quiz, req.body);
  if (errors.length) {
    req.flash('error', errors[0]);
    return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
  }

  // Create a new question with all details
  const question = await Question.create(questionData);

  // Add question reference to quiz and update total marks
  quiz.questions.push(question._id);
  quiz.totalMarks += question.marks;
  await quiz.save();
  
  req.flash('success', 'Question added.');
  return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
};

exports.deleteQuestion = async (req, res) => {
  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }
  await Question.deleteOne({ _id: req.params.questionId, quiz: quiz._id });
  await recalculateQuizMarks(quiz._id);
  req.flash('success', 'Question removed.');
  return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
};

exports.reviews = async (req, res) => {
  const quizzes = await Quiz.find({ createdBy: req.user._id }).select('_id');
  const quizIds = quizzes.map((quiz) => quiz._id);
  const attempts = quizIds.length
    ? await Attempt.find({ quiz: { $in: quizIds }, status: 'pending-review' })
        .populate('quiz', 'title category')
        .populate('student', 'name email')
        .sort('-submittedAt')
    : [];

  res.render('teacher/reviews', { title: 'Pending Reviews', attempts });
};

exports.attempts = async (req, res) => {
  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }
  const attempts = await Attempt.find({ quiz: quiz._id }).populate('student', 'name email').sort('-submittedAt');
  res.render('teacher/attempts', { title: 'Student Attempts', quiz, attempts });
};

exports.reviewAttempt = async (req, res) => {
  const attempt = await Attempt.findById(req.params.attemptId).populate('quiz').populate('answers.question').populate('student', 'name email');
  if (!attempt || attempt.quiz.createdBy.toString() !== req.user._id.toString()) {
    req.flash('error', 'Attempt not found.');
    return res.redirect('/teacher/quizzes');
  }
  return res.render('teacher/review-attempt', { title: 'Manual Review', attempt });
};

exports.updateReview = async (req, res) => {
  const attempt = await Attempt.findById(req.params.attemptId).populate('quiz').populate('answers.question');
  if (!attempt || attempt.quiz.createdBy.toString() !== req.user._id.toString()) {
    req.flash('error', 'Attempt not found.');
    return res.redirect('/teacher/quizzes');
  }

  const reviewErrors = [];
  attempt.answers.forEach((answer, index) => {
    if (!answer.needsManualReview) return;

    const submittedMarks = Number(req.body.marks?.[index]);
    const teacherCorrectAnswer = cleanText(req.body.teacherCorrectAnswers?.[index]);
    const reviewComment = cleanText(req.body.comments?.[index]);
    const isManualQuestion = ['short-answer', 'coding'].includes(answer.question.type);

    if (!Number.isFinite(submittedMarks)) {
      reviewErrors.push(`Assign marks for question ${index + 1}.`);
    }
    if (isManualQuestion && !teacherCorrectAnswer) {
      reviewErrors.push(`Add the right answer for question ${index + 1}.`);
    }
    if (!reviewComment) {
      reviewErrors.push(`Add a teacher comment for question ${index + 1}.`);
    }
  });

  if (reviewErrors.length) {
    req.flash('error', reviewErrors[0]);
    return res.redirect(`/teacher/attempts/${attempt._id}/review`);
  }

  attempt.answers.forEach((answer, index) => {
    const isManualQuestion = ['short-answer', 'coding'].includes(answer.question.type);

    if (answer.needsManualReview) {
      const submittedMarks = Number(req.body.marks?.[index]);
      const marks = Number.isFinite(submittedMarks) ? submittedMarks : 0;
      answer.marksObtained = Math.max(0, Math.min(marks, answer.question.marks));
      answer.isCorrect = answer.marksObtained === answer.question.marks;
      answer.needsManualReview = false;
    }

    if (isManualQuestion) {
      answer.teacherCorrectAnswer = cleanText(req.body.teacherCorrectAnswers?.[index]);
    }
    answer.reviewComment = cleanText(req.body.comments?.[index]);
  });

  attempt.score = attempt.answers.reduce((sum, answer) => sum + answer.marksObtained, 0);
  attempt.percentage = attempt.totalMarks ? Math.round((attempt.score / attempt.totalMarks) * 100) : 0;
  attempt.passed = attempt.percentage >= attempt.quiz.passingMarks;
  attempt.status = 'reviewed';
  await attempt.save();

  await Result.findOneAndUpdate(
    { attempt: attempt._id },
    {
      student: attempt.student,
      quiz: attempt.quiz._id,
      attempt: attempt._id,
      marksObtained: attempt.score,
      totalMarks: attempt.totalMarks,
      percentage: attempt.percentage,
      status: attempt.passed ? 'pass' : 'fail',
      grade: calculateGrade(attempt.percentage),
    },
    { upsert: true, runValidators: true }
  );

  const leaderboard = await Leaderboard.findOneAndUpdate(
    { quiz: attempt.quiz._id },
    { $setOnInsert: { quiz: attempt.quiz._id } },
    { upsert: true, returnDocument: 'after' }
  );
  await leaderboard.recordAttempt(attempt.student, attempt.score, attempt.percentage);
  await finalizeQuizAttempt(attempt._id);

  req.flash('success', 'Manual review saved.');
  return res.redirect(`/teacher/quizzes/${attempt.quiz._id}/attempts`);
};

exports.analytics = async (req, res) => {
  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }
  const attempts = await Attempt.find({ quiz: quiz._id });
  const average = attempts.length ? Math.round(attempts.reduce((sum, item) => sum + item.percentage, 0) / attempts.length) : 0;
  const passCount = attempts.filter((item) => item.passed).length;
  res.render('teacher/analytics', { title: 'Quiz Analytics', quiz, attempts, average, passCount });
};

exports.leaderboard = async (req, res) => {
  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }
  const leaderboard = await Leaderboard.findOne({ quiz: quiz._id }).populate('entries.student', 'name email');
  res.render('teacher/leaderboard', { title: 'Leaderboard', quiz, leaderboard });
};
