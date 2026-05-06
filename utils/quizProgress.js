const Attempt = require('../models/Attempt');
const Enrollment = require('../models/Enrollment');
const Progress = require('../models/Progress');
const GlobalLeaderboard = require('../models/GlobalLeaderboard');

function calculatePoints({ percentage, difficulty }) {
  const multiplier = difficulty === 'Hard' ? 1.5 : difficulty === 'Medium' ? 1.25 : 1;
  return Math.max(0, Math.round(Number(percentage || 0) * multiplier));
}

function utcDayNumber(date) {
  const value = date instanceof Date ? date : new Date(date);
  return Math.floor(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / 86400000);
}

function nextStreak(currentStreak, lastDate, now) {
  if (!lastDate) return 1;
  const diff = utcDayNumber(now) - utcDayNumber(lastDate);
  if (diff === 0) return currentStreak || 1;
  if (diff === 1) return (currentStreak || 0) + 1;
  return 1;
}

async function finalizeQuizAttempt(attemptId) {
  const attempt = await Attempt.findById(attemptId).populate('quiz');
  if (!attempt) throw new Error('Attempt not found');
  if (attempt.progressUpdated) {
    return { pointsEarned: attempt.pointsAwarded || 0, alreadyProcessed: true };
  }
  if (attempt.status === 'pending-review') {
    return { pointsEarned: 0, skipped: true };
  }

  const quiz = attempt.quiz;
  const now = new Date();
  const pointsEarned = calculatePoints({ percentage: attempt.percentage, difficulty: quiz?.difficulty });

  const enrollment = await Enrollment.findOne({ student: attempt.student, quiz: attempt.quiz._id });
  if (enrollment) {
    enrollment.status = 'completed';
    enrollment.bestAttemptId = attempt._id;
    enrollment.bestScore = attempt.percentage;
    await enrollment.save();
  }

  const progress = await Progress.findOneAndUpdate(
    { student: attempt.student },
    { $setOnInsert: { student: attempt.student } },
    { upsert: true, returnDocument: 'after' }
  );
  progress.quizzesByCategory = progress.quizzesByCategory || [];

  const previousAttempts = progress.totalAttempts || 0;
  progress.totalAttempts = previousAttempts + 1;
  progress.averageScore = previousAttempts
    ? Math.round(((progress.averageScore || 0) * previousAttempts + attempt.percentage) / (previousAttempts + 1))
    : attempt.percentage;
  progress.totalPoints = (progress.totalPoints || 0) + pointsEarned;
  progress.completedQuizzes = (progress.completedQuizzes || 0) + 1;
  progress.inProgressQuizzes = Math.max(0, (progress.inProgressQuizzes || 0) - 1);
  if (attempt.passed) progress.passedQuizzes = (progress.passedQuizzes || 0) + 1;
  else progress.failedQuizzes = (progress.failedQuizzes || 0) + 1;

  progress.streak = nextStreak(progress.streak, progress.lastAttemptDate, now);
  progress.lastAttemptDate = now;

  const category = quiz?.category || 'General';
  const categoryEntry = progress.quizzesByCategory.find((entry) => entry.category === category);
  if (!categoryEntry) {
    progress.quizzesByCategory.push({
      category,
      total: 1,
      completed: 1,
      averageScore: attempt.percentage,
    });
  } else {
    const previousCompleted = categoryEntry.completed || 0;
    categoryEntry.completed = previousCompleted + 1;
    categoryEntry.total = Math.max(categoryEntry.total || 0, categoryEntry.completed);
    categoryEntry.averageScore = previousCompleted
      ? Math.round(((categoryEntry.averageScore || 0) * previousCompleted + attempt.percentage) / (previousCompleted + 1))
      : attempt.percentage;
  }

  await progress.save();

  const leaderboard = await GlobalLeaderboard.findOneAndUpdate(
    { student: attempt.student },
    { $setOnInsert: { student: attempt.student } },
    { upsert: true, returnDocument: 'after' }
  );

  const previousCompleted = leaderboard.quizzesCompleted || 0;
  leaderboard.quizzesCompleted = previousCompleted + 1;
  leaderboard.averageScore = previousCompleted
    ? Math.round(((leaderboard.averageScore || 0) * previousCompleted + attempt.percentage) / (previousCompleted + 1))
    : attempt.percentage;
  leaderboard.totalPoints = (leaderboard.totalPoints || 0) + pointsEarned;

  if (attempt.percentage >= 90) leaderboard.goldPoints = (leaderboard.goldPoints || 0) + pointsEarned;
  else if (attempt.percentage >= 80) leaderboard.silverPoints = (leaderboard.silverPoints || 0) + pointsEarned;
  else if (attempt.percentage >= 70) leaderboard.bronzePoints = (leaderboard.bronzePoints || 0) + pointsEarned;

  leaderboard.streak = nextStreak(leaderboard.streak, leaderboard.lastUpdated, now);
  leaderboard.lastUpdated = now;
  await leaderboard.save();

  attempt.progressUpdated = true;
  attempt.pointsAwarded = pointsEarned;
  await attempt.save();

  return { pointsEarned, alreadyProcessed: false };
}

module.exports = { finalizeQuizAttempt, calculatePoints };
