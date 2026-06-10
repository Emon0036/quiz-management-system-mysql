const Enrollment = require('../models/Enrollment');
const Quiz = require('../models/Quiz');
const Progress = require('../models/Progress');
const GlobalLeaderboard = require('../models/GlobalLeaderboard');
const Attempt = require('../models/Attempt');
const Problem = require('../models/Problem');
const Submission = require('../models/Submission');
const User = require('../models/User');
const { getQuizAttemptLimit, hasReachedAttemptLimit } = require('../utils/attemptLimits');
const { formatTeacherName } = require('../utils/teacherCode');

function normalizeCategory(category) {
  const value = String(category || '').trim();
  return value || 'General';
}

function sortByCategoryName(left, right) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function sortByDisplayName(left, right) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function compactSearchText(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, '');
}

function teacherMatchesSearch(teacher, searchTerm) {
  if (!searchTerm) return true;
  const compactSearchTerm = compactSearchText(searchTerm);
  const teacherLabel = normalizeSearchText(teacher.label || formatTeacherName(teacher));
  const teacherCode = normalizeSearchText(teacher.teacherCode);
  const compactTeacherCode = compactSearchText(teacherCode);
  return normalizeSearchText(teacher.name).includes(searchTerm)
    || teacherLabel.includes(searchTerm)
    || teacherCode.includes(searchTerm)
    || Boolean(compactTeacherCode && (
      compactTeacherCode.includes(compactSearchTerm) ||
      compactSearchTerm.includes(compactTeacherCode)
    ));
}

function resolveTeacherSearch(teachers, teacherSearch) {
  const searchTerm = normalizeSearchText(teacherSearch);
  if (!searchTerm) return { teacher: null, matches: [] };

  const matches = teachers.filter((teacher) => teacherMatchesSearch(teacher, searchTerm));
  const compactSearchTerm = compactSearchText(searchTerm);
  const exactCodeMatches = matches.filter((teacher) => {
    const compactCode = compactSearchText(teacher.teacherCode);
    return compactCode && (compactCode === compactSearchTerm || compactSearchTerm.includes(compactCode));
  });
  if (exactCodeMatches.length === 1) return { teacher: exactCodeMatches[0], matches };

  const exactLabelMatches = matches.filter((teacher) => (
    normalizeSearchText(teacher.label) === searchTerm ||
    normalizeSearchText(teacher.name) === searchTerm
  ));
  if (exactLabelMatches.length === 1) return { teacher: exactLabelMatches[0], matches };

  return { teacher: matches.length === 1 ? matches[0] : null, matches };
}

function buildCategoryGroups(items, getCategory) {
  const grouped = new Map();

  items.forEach((item) => {
    const category = normalizeCategory(getCategory(item));
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(item);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => sortByCategoryName(left, right))
    .map(([category, groupedItems]) => ({ category, items: groupedItems }));
}

async function removeUnattemptedEnrollmentProgress(studentId, quiz) {
  if (!quiz) return;

  const progress = await Progress.findOne({ student: studentId });
  if (!progress) return;

  progress.totalQuizzes = Math.max(0, Number(progress.totalQuizzes || 0) - 1);
  progress.inProgressQuizzes = Math.max(0, Number(progress.inProgressQuizzes || 0) - 1);
  progress.quizzesByCategory = Array.isArray(progress.quizzesByCategory) ? progress.quizzesByCategory : [];

  const category = quiz.category || 'General';
  const categoryIndex = progress.quizzesByCategory.findIndex((item) => item.category === category);
  if (categoryIndex > -1) {
    const entry = progress.quizzesByCategory[categoryIndex];
    entry.total = Math.max(0, Number(entry.total || 0) - 1);
    if (Number(entry.total || 0) === 0 && Number(entry.completed || 0) === 0) {
      progress.quizzesByCategory.splice(categoryIndex, 1);
    }
  }

  await progress.save();
}

/**
 * Get available quizzes by category for student enrollment
 */
exports.browseQuizzes = async (req, res) => {
  try {
    const selectedCategory = String(req.query.category || 'all');
    const selectedDifficulty = String(req.query.difficulty || '');
    const selectedType = String(req.query.type || 'all');
    const requestedTeacherId = String(req.query.teacher || 'all');
    const teacherSearch = String(req.query.teacherSearch || '').trim();

    const activeTeachers = await User.find({
      role: 'teacher',
      teacherStatus: 'approved',
      accountStatus: 'active',
    });
    const allTeacherOptions = activeTeachers
      .map((teacher) => ({
        id: String(teacher._id),
        name: String(teacher.name || 'Teacher').trim() || 'Teacher',
        teacherCode: String(teacher.teacherCode || '').trim(),
        label: formatTeacherName(teacher),
      }))
      .sort((left, right) => sortByDisplayName(left.name, right.name) || sortByDisplayName(left.teacherCode, right.teacherCode));

    let selectedTeacher = requestedTeacherId !== 'all'
      ? allTeacherOptions.find((teacher) => teacher.id === requestedTeacherId) || null
      : null;
    let teacherSearchStatus = '';
    let teacherSearchMatchCount = 0;

    if (teacherSearch) {
      const searchResult = resolveTeacherSearch(allTeacherOptions, teacherSearch);
      selectedTeacher = searchResult.teacher;
      teacherSearchMatchCount = searchResult.matches.length;
      if (!selectedTeacher) {
        teacherSearchStatus = searchResult.matches.length > 1 ? 'multiple' : 'none';
      }
    }

    const effectiveTeacherId = selectedTeacher
      ? selectedTeacher.id
      : requestedTeacherId !== 'all' && !teacherSearch
        ? requestedTeacherId
        : 'all';
    const forceNoTeacherResults = Boolean(teacherSearch && !selectedTeacher);

    const filter = { status: 'published' };
    if (selectedCategory !== 'all') {
      filter.category = selectedCategory;
    }
    if (selectedDifficulty) filter.difficulty = selectedDifficulty;
    if (selectedType !== 'all') filter.examType = selectedType;
    if (forceNoTeacherResults) filter.createdBy = '__no_teacher_match__';
    else if (effectiveTeacherId !== 'all') filter.createdBy = effectiveTeacherId;

    const teacherAwareCategoryFilter = { status: 'published' };
    if (forceNoTeacherResults) teacherAwareCategoryFilter.createdBy = '__no_teacher_match__';
    else if (effectiveTeacherId !== 'all') teacherAwareCategoryFilter.createdBy = effectiveTeacherId;
    if (selectedDifficulty) teacherAwareCategoryFilter.difficulty = selectedDifficulty;
    if (selectedType !== 'all') teacherAwareCategoryFilter.examType = selectedType;

    const [quizzes, enrollments, rawCategories] = await Promise.all([
      Quiz.find(filter)
        .populate('createdBy', 'name teacherCode')
        .sort('-createdAt'),
      Enrollment.find({ student: req.user._id }),
      Quiz.distinct('category', teacherAwareCategoryFilter),
    ]);

    const groupedQuizzes = buildCategoryGroups(
      [...quizzes].sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })),
      (quiz) => quiz.category
    ).map((group) => ({ category: group.category, quizzes: group.items }));

    const enrolledQuizIds = enrollments.map((enrollment) => enrollment.quiz.toString());
    const enrollmentByQuizId = Object.fromEntries(
      enrollments.map((enrollment) => [
        String(enrollment.quiz),
        {
          attempts: Number(enrollment.attempts || 0),
          status: enrollment.status,
        },
      ])
    );

    const categories = rawCategories
      .map((category) => normalizeCategory(category))
      .sort(sortByCategoryName);

    res.render('student/quizzes', {
      title: 'Browse Exams',
      quizzes,
      groupedQuizzes,
      categories,
      teacherOptions: allTeacherOptions,
      teacherSearch,
      teacherSearchStatus,
      teacherSearchMatchCount,
      selectedCategory,
      selectedDifficulty,
      selectedType,
      selectedTeacherId: effectiveTeacherId,
      selectedTeacherName: selectedTeacher ? selectedTeacher.label : '',
      enrolledQuizIds,
      enrollmentByQuizId,
      query: req.query,
    });
  } catch (error) {
    console.error('Error browsing quizzes:', error.message);
    req.flash('error', 'Failed to load quizzes');
    res.redirect('/student/dashboard');
  }
};

/**
 * Enroll student in a quiz
 */
exports.enrollQuiz = async (req, res) => {
  try {
    const { quizId } = req.params;
    const quiz = await Quiz.findOne({ _id: quizId, status: 'published' });

    if (!quiz) {
      req.flash('error', 'This exam is not available for enrollment.');
      return res.redirect('/enrollments/browse');
    }

    // Check if already enrolled
    const existing = await Enrollment.findOne({
      student: req.user._id,
      quiz: quizId,
    });

    if (existing) {
      const attemptLimit = getQuizAttemptLimit(quiz);
      if (hasReachedAttemptLimit(existing, quiz)) {
        existing.attempts = 0;
        existing.status = 'enrolled';
        existing.bestScore = 0;
        existing.bestAttemptId = undefined;
        await existing.save();

        req.flash('success', `Purchased "${quiz.title}" again. You have ${attemptLimit} fresh attempt${attemptLimit === 1 ? '' : 's'}.`);
        return res.redirect('/enrollments/my-quizzes');
      }

      req.flash('success', 'You already have access to this exam.');
      return res.redirect('/enrollments/my-quizzes');
    }

    // Create enrollment
    await Enrollment.create({
      student: req.user._id,
      quiz: quizId,
    });

    const existingAttemptCount = await Attempt.countDocuments({ student: req.user._id, quiz: quizId });
    if (existingAttemptCount === 0) {
      // Update progress for a genuinely new exam in the student's workspace.
      const progress = await Progress.findOneAndUpdate(
        { student: req.user._id },
        { $setOnInsert: { student: req.user._id } },
        { upsert: true, returnDocument: 'after' }
      );
      progress.totalQuizzes += 1;
      progress.inProgressQuizzes += 1;

      // Update category progress
      const categoryIndex = progress.quizzesByCategory.findIndex((item) => item.category === quiz.category);
      if (categoryIndex > -1) {
        progress.quizzesByCategory[categoryIndex].total += 1;
      } else {
        progress.quizzesByCategory.push({
          category: quiz.category,
          total: 1,
          completed: 0,
          averageScore: 0,
        });
      }

      await progress.save();
    }

    req.flash('success', `Enrolled in "${quiz.title}"`);
    res.redirect('/enrollments/my-quizzes');
  } catch (error) {
    console.error('Error enrolling in quiz:', error.message);
    req.flash('error', 'Failed to enroll in quiz');
    res.redirect('/enrollments/browse');
  }
};

/**
 * Remove an enrolled exam from the student's My Exams list.
 * Historical attempts and results stay available in history/review pages.
 */
exports.deleteEnrollment = async (req, res) => {
  try {
    const { quizId } = req.params;
    const enrollment = await Enrollment.findOne({
      student: req.user._id,
      quiz: quizId,
    }).populate('quiz', 'title category');

    if (!enrollment) {
      req.flash('error', 'That enrolled exam was not found.');
      return res.redirect('/enrollments/my-quizzes');
    }

    const attemptCount = await Attempt.countDocuments({
      student: req.user._id,
      quiz: quizId,
    });
    const quizTitle = enrollment.quiz?.title || 'exam';

    await Enrollment.deleteOne({ _id: enrollment._id });

    if (attemptCount === 0) {
      await removeUnattemptedEnrollmentProgress(req.user._id, enrollment.quiz);
    }

    req.flash('success', `Removed "${quizTitle}" from My Exams.`);
    return res.redirect('/enrollments/my-quizzes');
  } catch (error) {
    console.error('Error deleting enrollment:', error.message);
    req.flash('error', 'Failed to remove enrolled exam.');
    return res.redirect('/enrollments/my-quizzes');
  }
};

/**
 * Get student's enrolled quizzes by category
 */
exports.getEnrolledQuizzes = async (req, res) => {
  try {
    const selectedType = String(req.query.type || 'all');
    const selectedCategory = String(req.query.category || 'all');
    const showCodingPractice = selectedCategory === 'all' && (selectedType === 'all' || selectedType === 'coding-test');
    const includeCoding = showCodingPractice;
    const includeQuizzes = true;

    let codingProblems = [];

    const [enrollments, problems, recentSubmissions] = await Promise.all([
      includeQuizzes
        ? Enrollment.find({ student: req.user._id })
            .populate({
              path: 'quiz',
              match: { status: 'published' },
              select: 'title category examType difficulty duration totalMarks passingMarks maxAttempts thumbnailUrl',
              populate: { path: 'createdBy', select: 'name teacherCode' },
            })
            .populate({ path: 'bestAttemptId', select: 'score percentage' })
        : Promise.resolve([]),
      includeCoding ? Problem.find({}).sort('-createdAt').limit(50) : Promise.resolve([]),
      includeCoding
        ? Submission.find({ student: req.user._id })
            .sort('-submittedAt')
            .limit(200)
            .populate('problem', 'title difficulty')
        : Promise.resolve([]),
    ]);

    const enrolledCategories = new Set();
    const filteredEnrollments = [];

    enrollments.forEach((enrollment) => {
      if (!enrollment.quiz) return;
      const examType = enrollment.quiz.examType || 'quiz';
      const category = normalizeCategory(enrollment.quiz.category);
      enrolledCategories.add(category);

      if (selectedType !== 'all' && examType !== selectedType) return;
      if (selectedCategory !== 'all' && category !== selectedCategory) return;
      filteredEnrollments.push(enrollment);
    });

    filteredEnrollments.sort((left, right) => {
      const leftCategory = normalizeCategory(left.quiz?.category);
      const rightCategory = normalizeCategory(right.quiz?.category);
      const categoryOrder = sortByCategoryName(leftCategory, rightCategory);
      if (categoryOrder !== 0) return categoryOrder;
      return left.quiz.title.localeCompare(right.quiz.title, undefined, { sensitivity: 'base' });
    });

    const categoryGroups = buildCategoryGroups(filteredEnrollments, (enrollment) => enrollment.quiz?.category)
      .map((group) => ({ category: group.category, enrollments: group.items }));

    if (includeCoding) {
      const latestSubmissionByProblemId = new Map();
      recentSubmissions.forEach((submission) => {
        const problemId = submission.problem?._id || submission.problem;
        if (!problemId) return;
        const key = String(problemId);
        if (!latestSubmissionByProblemId.has(key)) latestSubmissionByProblemId.set(key, submission);
      });

      codingProblems = problems.map((problem) => ({
        problem,
        latestSubmission: latestSubmissionByProblemId.get(String(problem._id)) || null,
      }));
    }

    res.render('student/my-quizzes', {
      title: 'My Exams',
      categoryGroups,
      selectedType,
      selectedCategory,
      enrollmentCategories: Array.from(enrolledCategories).sort(sortByCategoryName),
      codingProblems,
    });
  } catch (error) {
    console.error('Error fetching enrolled quizzes:', error.message);
    req.flash('error', 'Failed to load quizzes');
    res.redirect('/student/dashboard');
  }
};

/**
 * Get student progress
 */
exports.getProgress = async (req, res) => {
  try {
    let progress = await Progress.findOne({ student: req.user._id });
    if (!progress) progress = await Progress.create({ student: req.user._id });

    res.render('student/progress', {
      title: 'Your Progress',
      progress,
    });
  } catch (error) {
    console.error('Error fetching progress:', error.message);
    req.flash('error', 'Failed to load progress');
    res.redirect('/student/dashboard');
  }
};

/**
 * Get global leaderboard with top students
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = 50;
    const skip = (page - 1) * limit;

    // Get top students
    const topStudents = await GlobalLeaderboard.find()
      .populate('student', 'name profileImage')
      .sort({ totalPoints: -1, averageScore: -1 })
      .limit(limit)
      .skip(skip);

    // Calculate ranks
    topStudents.forEach((entry, index) => {
      entry.rank = skip + index + 1;
    });

    // Get current user's rank
    let userLeaderboard = await GlobalLeaderboard.findOne({ student: req.user._id });
    if (!userLeaderboard) userLeaderboard = await GlobalLeaderboard.create({ student: req.user._id });
    const userRank = await GlobalLeaderboard.countDocuments({
      $or: [
        { totalPoints: { $gt: userLeaderboard.totalPoints || 0 } },
        {
          totalPoints: userLeaderboard.totalPoints || 0,
          averageScore: { $gt: userLeaderboard.averageScore || 0 },
        },
      ],
    }) + 1;

    const totalStudents = await GlobalLeaderboard.countDocuments();

    res.render('student/global-leaderboard', {
      title: 'Global Leaderboard',
      topStudents: topStudents.map((entry, index) => ({
        ...entry.toObject(),
        badge: entry.rank === 1 ? 'gold' : entry.rank === 2 ? 'silver' : entry.rank === 3 ? 'bronze' : entry.rank <= 5 ? 'top5' : '',
      })),
      userRank,
      userLeaderboard,
      currentPage: page,
      totalPages: Math.ceil(totalStudents / limit),
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error.message);
    req.flash('error', 'Failed to load leaderboard');
    res.redirect('/student/dashboard');
  }
};
