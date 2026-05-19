const DEFAULT_ATTEMPT_LIMIT = 10;
const MIN_ATTEMPT_LIMIT = 1;
const MAX_ATTEMPT_LIMIT = 100;

function normalizeAttemptLimit(value, fallback = DEFAULT_ATTEMPT_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_ATTEMPT_LIMIT, Math.max(MIN_ATTEMPT_LIMIT, Math.floor(parsed)));
}

function getQuizAttemptLimit(quiz) {
  return normalizeAttemptLimit(quiz?.maxAttempts, DEFAULT_ATTEMPT_LIMIT);
}

function getEnrollmentAttemptCount(enrollment) {
  const attempts = Number(enrollment?.attempts || 0);
  return Number.isFinite(attempts) && attempts > 0 ? attempts : 0;
}

function hasReachedAttemptLimit(enrollment, quiz) {
  return getEnrollmentAttemptCount(enrollment) >= getQuizAttemptLimit(quiz);
}

module.exports = {
  DEFAULT_ATTEMPT_LIMIT,
  MAX_ATTEMPT_LIMIT,
  MIN_ATTEMPT_LIMIT,
  getEnrollmentAttemptCount,
  getQuizAttemptLimit,
  hasReachedAttemptLimit,
  normalizeAttemptLimit,
};
