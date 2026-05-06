const Enrollment = require('../models/Enrollment');
const Quiz = require('../models/Quiz');
const Progress = require('../models/Progress');
const GlobalLeaderboard = require('../models/GlobalLeaderboard');
const Attempt = require('../models/Attempt');
const Problem = require('../models/Problem');
const Submission = require('../models/Submission');

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

/**
 * Get available quizzes by category for student enrollment
 */
exports.browseQuizzes = async (req, res) => {
  try {
    const selectedCategory = String(req.query.category || 'all');
    const selectedDifficulty = String(req.query.difficulty || '');
    const selectedType = String(req.query.type || 'all');
    const selectedTeacherId = String(req.query.teacher || 'all');
    
    const filter = { status: 'published' };
    if (selectedCategory !== 'all') {
      filter.category = selectedCategory;
    }
    if (selectedDifficulty) filter.difficulty = selectedDifficulty;
    if (selectedType !== 'all') filter.examType = selectedType;
    if (selectedTeacherId !== 'all') filter.createdBy = selectedTeacherId;

    const teacherAwareCategoryFilter = { status: 'published' };
    if (selectedTeacherId !== 'all') teacherAwareCategoryFilter.createdBy = selectedTeacherId;
    if (selectedDifficulty) teacherAwareCategoryFilter.difficulty = selectedDifficulty;
    if (selectedType !== 'all') teacherAwareCategoryFilter.examType = selectedType;

    const teacherSourceFilter = { status: 'published' };
    if (selectedCategory !== 'all') teacherSourceFilter.category = selectedCategory;
    if (selectedDifficulty) teacherSourceFilter.difficulty = selectedDifficulty;
    if (selectedType !== 'all') teacherSourceFilter.examType = selectedType;

    const [quizzes, enrollments, rawCategories, teacherSourceQuizzes] = await Promise.all([
      Quiz.find(filter)
        .populate('createdBy', 'name')
        .sort('-createdAt'),
      Enrollment.find({ student: req.user._id }),
      Quiz.distinct('category', teacherAwareCategoryFilter),
      Quiz.find(teacherSourceFilter)
        .select('createdBy')
        .populate('createdBy', 'name role accountStatus'),
    ]);

    const groupedQuizzes = buildCategoryGroups(
      [...quizzes].sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })),
      (quiz) => quiz.category
    ).map((group) => ({ category: group.category, quizzes: group.items }));

    const enrolledQuizIds = enrollments.map((enrollment) => enrollment.quiz.toString());

    const categories = rawCategories
      .map((category) => normalizeCategory(category))
      .sort(sortByCategoryName);

    const teacherMap = new Map();
    teacherSourceQuizzes.forEach((quiz) => {
      const teacher = quiz.createdBy;
      if (!teacher || !teacher._id) return;
      if (teacher.role && teacher.role !== 'teacher') return;
      if (teacher.accountStatus === 'blocked') return;
      const id = String(teacher._id);
      if (!teacherMap.has(id)) {
        teacherMap.set(id, {
          id,
          name: String(teacher.name || 'Teacher').trim() || 'Teacher',
        });
      }
    });

    const teacherOptions = Array.from(teacherMap.values())
      .sort((left, right) => sortByDisplayName(left.name, right.name));

    const selectedTeacher = teacherOptions.find((teacher) => teacher.id === selectedTeacherId) || null;

    res.render('student/quizzes', {
      title: 'Browse Exams',
      quizzes,
      groupedQuizzes,
      categories,
      teacherOptions,
      selectedCategory,
      selectedDifficulty,
      selectedType,
      selectedTeacherId,
      selectedTeacherName: selectedTeacher ? selectedTeacher.name : '',
      enrolledQuizIds,
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
      req.flash('success', 'You are already enrolled in this exam.');
      return res.redirect('/enrollments/my-quizzes');
    }

    // Create enrollment
    await Enrollment.create({
      student: req.user._id,
      quiz: quizId,
    });

    // Update progress
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

    req.flash('success', `Enrolled in "${quiz.title}"`);
    res.redirect('/enrollments/my-quizzes');
  } catch (error) {
    console.error('Error enrolling in quiz:', error.message);
    req.flash('error', 'Failed to enroll in quiz');
    res.redirect('/enrollments/browse');
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
              select: 'title category examType difficulty duration totalMarks passingMarks thumbnailUrl',
              populate: { path: 'createdBy', select: 'name' },
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
