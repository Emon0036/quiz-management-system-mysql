const Quiz = require('../models/Quiz');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Result = require('../models/Result');
const Leaderboard = require('../models/Leaderboard');
const Enrollment = require('../models/Enrollment');
const ExamRosterEntry = require('../models/ExamRosterEntry');
const { finalizeQuizAttempt } = require('../utils/quizProgress');
const { uploadQuizThumbnail, destroyQuizThumbnail } = require('../utils/quizThumbnailService');
const {
  formatRosterCsv,
  normalizeExamName,
  normalizeStudentId,
  normalizeStudentName,
  parseRosterSheet,
  updateRosterAttemptFromReview,
} = require('../utils/examRosterSheet');
const {
  DEFAULT_ATTEMPT_LIMIT,
  MAX_ATTEMPT_LIMIT,
  MIN_ATTEMPT_LIMIT,
  normalizeAttemptLimit,
} = require('../utils/attemptLimits');

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

function getDocumentId(value) {
  if (!value) return '';
  if (value._id) return String(value._id);
  if (value.id) return String(value.id);
  return String(value);
}

function buildQuizPayload(body) {
  const duration = Number(body.duration);
  const passingMarks = Number(body.passingMarks);
  const submittedAttemptLimit = String(body.maxAttempts || '').trim();
  const parsedAttemptLimit = Number(submittedAttemptLimit || DEFAULT_ATTEMPT_LIMIT);
  const payload = {
    examType: EXAM_TYPES.includes(body.examType) ? body.examType : 'quiz',
    title: cleanText(body.title),
    description: cleanText(body.description),
    category: cleanText(body.category) || 'General Knowledge',
    difficulty: DIFFICULTY_LEVELS.includes(body.difficulty) ? body.difficulty : 'Medium',
    duration,
    passingMarks,
    maxAttempts: normalizeAttemptLimit(parsedAttemptLimit),
  };

  const errors = [];
  if (!payload.title) errors.push('Quiz title is required.');
  if (!Number.isFinite(duration) || duration < 1) errors.push('Duration must be at least 1 minute.');
  if (!Number.isFinite(passingMarks) || passingMarks < 0 || passingMarks > 100) {
    errors.push('Passing percentage must be between 0 and 100.');
  }
  if (
    !Number.isFinite(parsedAttemptLimit) ||
    parsedAttemptLimit < MIN_ATTEMPT_LIMIT ||
    parsedAttemptLimit > MAX_ATTEMPT_LIMIT
  ) {
    errors.push(`Attempts per purchase must be between ${MIN_ATTEMPT_LIMIT} and ${MAX_ATTEMPT_LIMIT}.`);
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
    const correctAnswer = cleanText(body.correctAnswer);
    if (!correctAnswer) errors.push('Short answer questions require a correct answer.');
    payload.options = [];
    payload.correctAnswer = correctAnswer;
  } else if (type === 'coding') {
    const correctAnswer = cleanText(body.correctAnswer);
    const testCases = parseCodingTestCases(body);
    payload.language = cleanText(body.language);
    if (!payload.language) errors.push('Programming language is required for coding questions.');
    if (!correctAnswer) errors.push('Coding questions require a correct answer or reference solution.');
    payload.correctAnswer = correctAnswer;
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

async function getRosterEntriesForQuiz(quizId) {
  return ExamRosterEntry.find({ quiz: quizId }).sort('studentId');
}

function getUploadedFile(req, fieldName) {
  return req.files?.[fieldName]?.[0] || null;
}

function getRosterRowsForQuiz(buffer, quizTitle) {
  const rows = parseRosterSheet(buffer, quizTitle);
  const quizName = normalizeExamName(quizTitle);
  return rows.filter((row) => !row.examName || normalizeExamName(row.examName) === quizName);
}

async function importRosterRowsForQuiz({ quiz, teacherId, rows }) {
  const existingEntries = await ExamRosterEntry.find({ quiz: quiz._id });
  const existingByStudentId = new Map(existingEntries.map((entry) => [entry.studentId, entry]));
  const uploadedStudentIds = new Set();
  let importedCount = 0;

  for (const row of rows) {
    const studentId = normalizeStudentId(row.studentId);
    uploadedStudentIds.add(studentId);
    let entry = existingByStudentId.get(studentId);

    if (!entry) {
      entry = await ExamRosterEntry.create({
        teacher: teacherId,
        quiz: quiz._id,
        studentId,
        studentName: normalizeStudentName(row.studentName),
        examName: row.examName || quiz.title,
        examDate: row.examDate,
        attempts: [],
        sourceData: row.sourceData,
      });
    } else {
      entry.teacher = teacherId;
      entry.studentName = normalizeStudentName(row.studentName) || entry.studentName || '';
      entry.examName = row.examName || quiz.title;
      entry.examDate = row.examDate;
      entry.sourceData = row.sourceData;
      await entry.save();
    }

    importedCount += 1;
  }

  const staleEntries = existingEntries.filter((entry) => !uploadedStudentIds.has(entry.studentId));
  for (const entry of staleEntries) {
    await ExamRosterEntry.deleteOne({ _id: entry._id });
  }

  return { importedCount, removedCount: staleEntries.length };
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
  const requestedType = String(req.query.type || 'all');
  const selectedType = EXAM_TYPES.includes(requestedType) ? requestedType : 'all';
  const quizFilter = { createdBy: req.user._id };
  if (selectedType !== 'all') quizFilter.examType = selectedType;

  const [quizzes, allQuizzes] = await Promise.all([
    Quiz.find(quizFilter).sort('-createdAt'),
    Quiz.find({ createdBy: req.user._id }).select('status'),
  ]);
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

  res.render('teacher/quizzes', {
    title: 'Manage Quizzes',
    quizzes,
    allQuizCount: allQuizzes.length,
    allPublishedCount: allQuizzes.filter((quiz) => quiz.status === 'published').length,
    allDraftCount: allQuizzes.filter((quiz) => quiz.status !== 'published').length,
    selectedType,
    query: req.query,
  });
};

exports.showCreateQuiz = (req, res) =>
  res.render('teacher/quiz-form', {
    title: 'Create Quiz',
    quiz: { maxAttempts: DEFAULT_ATTEMPT_LIMIT },
    questions: [],
    action: '/teacher/quizzes',
  });

exports.createQuiz = async (req, res) => {
  const { payload, errors } = buildQuizPayload(req.body);
  const shouldCreateAnother = cleanText(req.body.saveAction) === 'create-another';
  if (errors.length) {
    req.flash('error', errors[0]);
    return res.redirect('/teacher/quizzes/new');
  }

  const rosterFile = getUploadedFile(req, 'rosterSheet');
  let rosterRows = [];
  let skippedRosterRows = 0;
  if (rosterFile) {
    try {
      const allRows = parseRosterSheet(rosterFile.buffer, payload.title);
      rosterRows = getRosterRowsForQuiz(rosterFile.buffer, payload.title);
      skippedRosterRows = allRows.length - rosterRows.length;
    } catch (error) {
      req.flash('error', error.message || 'Unable to read the uploaded student sheet.');
      return res.redirect('/teacher/quizzes/new');
    }

    if (!rosterRows.length) {
      req.flash('error', `No student sheet rows matched this exam name: ${payload.title}`);
      return res.redirect('/teacher/quizzes/new');
    }
  }

  let thumbnailPayload = {};
  const thumbnailFile = getUploadedFile(req, 'thumbnail');
  if (thumbnailFile) {
    try {
      thumbnailPayload = await uploadQuizThumbnail(thumbnailFile, 'new');
    } catch (error) {
      req.flash('error', error.message || 'Thumbnail upload failed.');
      return res.redirect('/teacher/quizzes/new');
    }
  }

  const quiz = await Quiz.create({ ...payload, ...thumbnailPayload, createdBy: req.user._id, status: 'draft' });
  await Leaderboard.create({ quiz: quiz._id, entries: [] });

  if (rosterRows.length) {
    const rosterResult = await importRosterRowsForQuiz({ quiz, teacherId: req.user._id, rows: rosterRows });
    const skippedMessage = skippedRosterRows
      ? ` ${skippedRosterRows} row${skippedRosterRows === 1 ? '' : 's'} skipped for other exams.`
      : '';
    req.flash(
      'success',
      `Quiz created and ${rosterResult.importedCount} student sheet row${rosterResult.importedCount === 1 ? '' : 's'} imported.${skippedMessage} ${
        shouldCreateAnother ? 'Ready for the next quiz.' : 'Add questions next.'
      }`
    );
  } else {
    req.flash('success', shouldCreateAnother ? 'Quiz created. Ready for the next quiz.' : 'Quiz created. Add questions next.');
  }

  if (shouldCreateAnother) return res.redirect('/teacher/quizzes/new');
  return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
};

exports.showEditQuiz = async (req, res) => {
  const quiz = await getTeacherQuiz(req.params.quizId, req.user._id);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }
  const rosterEntries = await getRosterEntriesForQuiz(quiz._id);
  return res.render('teacher/quiz-form', {
    title: 'Edit Quiz',
    quiz,
    questions: quiz.questions,
    rosterEntries,
    action: `/teacher/quizzes/${quiz._id}?_method=PUT`,
  });
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

  const thumbnailFile = getUploadedFile(req, 'thumbnail');
  if (thumbnailFile) {
    let thumbnailPayload = {};
    try {
      thumbnailPayload = await uploadQuizThumbnail(thumbnailFile, quiz._id);
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
    ExamRosterEntry.deleteMany({ quiz: quiz._id }),
    Quiz.deleteOne({ _id: quiz._id }),
  ]);
  req.flash('success', 'Quiz deleted.');
  return res.redirect('/teacher/quizzes');
};

exports.uploadRoster = async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.quizId, createdBy: req.user._id });
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }

  if (!req.file || !req.file.buffer) {
    req.flash('error', 'Please upload a CSV file exported from Google Sheets.');
    return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
  }

  let allRows = [];
  let matchingRows = [];
  try {
    allRows = parseRosterSheet(req.file.buffer, quiz.title);
    matchingRows = getRosterRowsForQuiz(req.file.buffer, quiz.title);
  } catch (error) {
    req.flash('error', error.message || 'Unable to read the uploaded sheet.');
    return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
  }

  if (!matchingRows.length) {
    req.flash('error', `No rows matched this exam name: ${quiz.title}`);
    return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
  }

  const rosterResult = await importRosterRowsForQuiz({ quiz, teacherId: req.user._id, rows: matchingRows });
  const skippedCount = allRows.length - matchingRows.length;
  const staleMessage = rosterResult.removedCount
    ? `, ${rosterResult.removedCount} old row${rosterResult.removedCount === 1 ? '' : 's'} removed`
    : '';
  const skippedMessage = skippedCount
    ? `, ${skippedCount} row${skippedCount === 1 ? '' : 's'} skipped for other exams`
    : '';
  req.flash('success', `Student sheet imported: ${rosterResult.importedCount} row${rosterResult.importedCount === 1 ? '' : 's'} ready${staleMessage}${skippedMessage}.`);
  return res.redirect(`/teacher/quizzes/${quiz._id}/edit`);
};

exports.downloadRoster = async (req, res) => {
  const quiz = await Quiz.findOne({ _id: req.params.quizId, createdBy: req.user._id });
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/teacher/quizzes');
  }

  const entries = await getRosterEntriesForQuiz(quiz._id);
  const csv = formatRosterCsv(entries, quiz);
  const filename = `${quiz.title || 'exam'}-student-sheet.csv`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename || 'student-sheet'}.csv"`);
  return res.send(csv);
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
    const savedCorrectAnswer = cleanText(answer.question.correctAnswer);
    const reviewComment = cleanText(req.body.comments?.[index]);
    const isManualQuestion = ['short-answer', 'coding'].includes(answer.question.type);

    if (!Number.isFinite(submittedMarks)) {
      reviewErrors.push(`Assign marks for question ${index + 1}.`);
    }
    if (isManualQuestion && !teacherCorrectAnswer && !savedCorrectAnswer) {
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
      answer.teacherCorrectAnswer = cleanText(req.body.teacherCorrectAnswers?.[index]) || cleanText(answer.question.correctAnswer);
    }
    answer.reviewComment = cleanText(req.body.comments?.[index]);
  });

  const quizId = getDocumentId(attempt.quiz);
  const studentId = getDocumentId(attempt.student);
  const attemptId = getDocumentId(attempt);
  attempt.score = attempt.answers.reduce((sum, answer) => sum + answer.marksObtained, 0);
  attempt.percentage = attempt.totalMarks ? Math.round((attempt.score / attempt.totalMarks) * 100) : 0;
  attempt.passed = attempt.percentage >= attempt.quiz.passingMarks;
  attempt.status = 'reviewed';
  await attempt.save();

  await Result.findOneAndUpdate(
    { attempt: attemptId },
    {
      student: studentId,
      quiz: quizId,
      attempt: attemptId,
      marksObtained: attempt.score,
      totalMarks: attempt.totalMarks,
      percentage: attempt.percentage,
      status: attempt.passed ? 'pass' : 'fail',
      grade: calculateGrade(attempt.percentage),
    },
    { upsert: true, runValidators: true }
  );

  const leaderboard = await Leaderboard.findOneAndUpdate(
    { quiz: quizId },
    { $setOnInsert: { quiz: quizId } },
    { upsert: true, returnDocument: 'after' }
  );
  await leaderboard.recordAttempt(studentId, attempt.score, attempt.percentage);
  await updateRosterAttemptFromReview(attempt);
  await finalizeQuizAttempt(attemptId);

  req.flash('success', 'Manual review saved.');
  return res.redirect(`/teacher/quizzes/${quizId}/attempts`);
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
