-- Online Quiz Management System - Database DDL
-- Project Show submission file
-- Target DBMS: MySQL 8+

CREATE DATABASE IF NOT EXISTS quiz_management_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE quiz_management_system;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(24) NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NULL,
  role ENUM('admin', 'teacher', 'student') NOT NULL DEFAULT 'student',
  teacherCode VARCHAR(32) NULL,
  teacherStatus ENUM('none', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'none',
  accountStatus ENUM('active', 'blocked') NOT NULL DEFAULT 'active',
  approvedBy CHAR(24) NULL,
  approvedAt DATETIME NULL,
  blockedBy CHAR(24) NULL,
  blockedAt DATETIME NULL,
  profileImage VARCHAR(500) NOT NULL DEFAULT '/images/default-avatar.png',
  department VARCHAR(150) NOT NULL DEFAULT '',
  institution VARCHAR(180) NOT NULL DEFAULT '',
  designation VARCHAR(120) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  studentId VARCHAR(80) NOT NULL DEFAULT '',
  section VARCHAR(80) NOT NULL DEFAULT '',
  batch VARCHAR(80) NOT NULL DEFAULT '',
  officeLocation VARCHAR(150) NOT NULL DEFAULT '',
  officeHours VARCHAR(120) NOT NULL DEFAULT '',
  expertise LONGTEXT NULL,
  bio LONGTEXT NULL,
  resetPasswordToken VARCHAR(255) NULL,
  resetPasswordExpires DATETIME NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  UNIQUE KEY users_teacher_code_unique (teacherCode),
  KEY users_approved_by_idx (approvedBy),
  KEY users_blocked_by_idx (blockedBy),
  CONSTRAINT fk_users_approved_by FOREIGN KEY (approvedBy) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_blocked_by FOREIGN KEY (blockedBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
  id CHAR(24) NOT NULL,
  user CHAR(24) NOT NULL,
  createdBy CHAR(24) NULL,
  permissions LONGTEXT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY admins_user_unique (user),
  KEY admins_created_by_idx (createdBy),
  CONSTRAINT fk_admins_user FOREIGN KEY (user) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_admins_created_by FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizzes (
  id CHAR(24) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description LONGTEXT NULL,
  category VARCHAR(255) NOT NULL DEFAULT 'General Knowledge',
  thumbnailUrl VARCHAR(1000) NOT NULL DEFAULT '',
  thumbnailPublicId VARCHAR(500) NOT NULL DEFAULT '',
  examType ENUM('quiz', 'true-false', 'short-answer', 'coding-test') NOT NULL DEFAULT 'quiz',
  difficulty ENUM('Easy', 'Medium', 'Hard') NOT NULL DEFAULT 'Medium',
  duration INT NOT NULL,
  passingMarks FLOAT NOT NULL,
  maxAttempts INT NOT NULL DEFAULT 10,
  totalMarks FLOAT NOT NULL DEFAULT 0,
  createdBy CHAR(24) NOT NULL,
  questions LONGTEXT NULL,
  status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY quizzes_status_category_difficulty_idx (status, category, difficulty),
  KEY quizzes_status_exam_type_category_idx (status, examType, category),
  KEY quizzes_created_by_created_at_idx (createdBy, createdAt),
  CONSTRAINT fk_quizzes_created_by FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
  id CHAR(24) NOT NULL,
  quiz CHAR(24) NOT NULL,
  questionText LONGTEXT NOT NULL,
  type ENUM('multiple-choice', 'true-false', 'short-answer', 'coding') NOT NULL,
  options LONGTEXT NULL,
  correctAnswer LONGTEXT NULL,
  explanation LONGTEXT NULL,
  marks FLOAT NOT NULL DEFAULT 1,
  codeTemplate LONGTEXT NULL,
  language VARCHAR(100) NULL,
  testCases LONGTEXT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY questions_quiz_idx (quiz),
  CONSTRAINT fk_questions_quiz FOREIGN KEY (quiz) REFERENCES quizzes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attempts (
  id CHAR(24) NOT NULL,
  student CHAR(24) NOT NULL,
  quiz CHAR(24) NOT NULL,
  attemptNumber INT NOT NULL DEFAULT 1,
  answers LONGTEXT NULL,
  score FLOAT NOT NULL DEFAULT 0,
  totalMarks FLOAT NOT NULL DEFAULT 0,
  percentage FLOAT NOT NULL DEFAULT 0,
  status ENUM('submitted', 'pending-review', 'reviewed') NOT NULL DEFAULT 'submitted',
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  autoSubmitted BOOLEAN NOT NULL DEFAULT FALSE,
  autoSubmitReason VARCHAR(255) NOT NULL DEFAULT '',
  startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  timeSpent INT NOT NULL DEFAULT 0,
  progressUpdated BOOLEAN NOT NULL DEFAULT FALSE,
  pointsAwarded FLOAT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY attempts_student_quiz_submitted_at_idx (student, quiz, submittedAt),
  KEY attempts_quiz_percentage_time_spent_idx (quiz, percentage, timeSpent),
  KEY attempts_progress_updated_idx (progressUpdated),
  CONSTRAINT fk_attempts_student FOREIGN KEY (student) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempts_quiz FOREIGN KEY (quiz) REFERENCES quizzes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS results (
  id CHAR(24) NOT NULL,
  student CHAR(24) NOT NULL,
  quiz CHAR(24) NOT NULL,
  attempt CHAR(24) NOT NULL,
  marksObtained FLOAT NOT NULL,
  totalMarks FLOAT NOT NULL,
  percentage FLOAT NOT NULL,
  status ENUM('pass', 'fail', 'pending-review') NOT NULL,
  grade VARCHAR(2) NOT NULL DEFAULT 'F',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY results_student_quiz_idx (student, quiz),
  KEY results_attempt_idx (attempt),
  CONSTRAINT fk_results_student FOREIGN KEY (student) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_results_quiz FOREIGN KEY (quiz) REFERENCES quizzes(id) ON DELETE CASCADE,
  CONSTRAINT fk_results_attempt FOREIGN KEY (attempt) REFERENCES attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enrollments (
  id CHAR(24) NOT NULL,
  student CHAR(24) NOT NULL,
  quiz CHAR(24) NOT NULL,
  enrolledAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('enrolled', 'pending-review', 'completed', 'expired') NOT NULL DEFAULT 'enrolled',
  attempts INT NOT NULL DEFAULT 0,
  bestScore FLOAT NOT NULL DEFAULT 0,
  bestAttemptId CHAR(24) NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY enrollments_student_quiz_unique (student, quiz),
  KEY enrollments_student_status_idx (student, status),
  KEY enrollments_quiz_status_idx (quiz, status),
  KEY enrollments_best_attempt_idx (bestAttemptId),
  CONSTRAINT fk_enrollments_student FOREIGN KEY (student) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_enrollments_quiz FOREIGN KEY (quiz) REFERENCES quizzes(id) ON DELETE CASCADE,
  CONSTRAINT fk_enrollments_best_attempt FOREIGN KEY (bestAttemptId) REFERENCES attempts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS progress (
  id CHAR(24) NOT NULL,
  student CHAR(24) NOT NULL,
  totalQuizzes INT NOT NULL DEFAULT 0,
  completedQuizzes INT NOT NULL DEFAULT 0,
  inProgressQuizzes INT NOT NULL DEFAULT 0,
  averageScore FLOAT NOT NULL DEFAULT 0,
  totalPoints FLOAT NOT NULL DEFAULT 0,
  totalAttempts INT NOT NULL DEFAULT 0,
  passedQuizzes INT NOT NULL DEFAULT 0,
  failedQuizzes INT NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,
  lastAttemptDate DATETIME NULL,
  badges LONGTEXT NULL,
  quizzesByCategory LONGTEXT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY progress_student_idx (student),
  KEY progress_points_average_idx (totalPoints, averageScore),
  CONSTRAINT fk_progress_student FOREIGN KEY (student) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS global_leaderboards (
  id CHAR(24) NOT NULL,
  student CHAR(24) NOT NULL,
  totalPoints FLOAT NOT NULL DEFAULT 0,
  averageScore FLOAT NOT NULL DEFAULT 0,
  quizzesCompleted INT NOT NULL DEFAULT 0,
  rank INT NOT NULL DEFAULT 0,
  badge ENUM('gold', 'silver', 'bronze', 'none') NOT NULL DEFAULT 'none',
  goldPoints FLOAT NOT NULL DEFAULT 0,
  silverPoints FLOAT NOT NULL DEFAULT 0,
  bronzePoints FLOAT NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,
  lastUpdated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY global_leaderboards_student_unique (student),
  KEY global_leaderboards_points_average_idx (totalPoints, averageScore),
  KEY global_leaderboards_rank_idx (rank),
  KEY global_leaderboards_badge_idx (badge),
  CONSTRAINT fk_global_leaderboards_student FOREIGN KEY (student) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leaderboards (
  id CHAR(24) NOT NULL,
  quiz CHAR(24) NOT NULL,
  entries LONGTEXT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY leaderboards_quiz_unique (quiz),
  CONSTRAINT fk_leaderboards_quiz FOREIGN KEY (quiz) REFERENCES quizzes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_roster_entries (
  id CHAR(24) NOT NULL,
  teacher CHAR(24) NOT NULL,
  quiz CHAR(24) NOT NULL,
  student CHAR(24) NULL,
  section VARCHAR(80) NOT NULL DEFAULT '',
  studentId VARCHAR(100) NOT NULL,
  studentName VARCHAR(150) NULL,
  examName VARCHAR(255) NOT NULL,
  examDate DATETIME NULL,
  attempts LONGTEXT NULL,
  sourceData LONGTEXT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY exam_roster_teacher_quiz_idx (teacher, quiz),
  KEY exam_roster_quiz_student_id_idx (quiz, studentId),
  KEY exam_roster_student_idx (student),
  CONSTRAINT fk_exam_roster_teacher FOREIGN KEY (teacher) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_exam_roster_quiz FOREIGN KEY (quiz) REFERENCES quizzes(id) ON DELETE CASCADE,
  CONSTRAINT fk_exam_roster_student FOREIGN KEY (student) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS problems (
  id CHAR(24) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description LONGTEXT NOT NULL,
  inputFormat LONGTEXT NULL,
  outputFormat LONGTEXT NULL,
  sampleInput LONGTEXT NULL,
  sampleOutput LONGTEXT NULL,
  testCases LONGTEXT NULL,
  difficulty ENUM('Easy', 'Medium', 'Hard') NOT NULL DEFAULT 'Medium',
  createdBy CHAR(24) NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY problems_created_by_idx (createdBy),
  CONSTRAINT fk_problems_created_by FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS submissions (
  id CHAR(24) NOT NULL,
  problem CHAR(24) NOT NULL,
  student CHAR(24) NOT NULL,
  code LONGTEXT NOT NULL,
  language ENUM('c', 'cpp', 'java', 'javascript', 'python') NOT NULL,
  status ENUM('pending-review', 'reviewed') NOT NULL DEFAULT 'pending-review',
  marksAwarded FLOAT NOT NULL DEFAULT 0,
  teacherComment LONGTEXT NULL,
  correctedCode LONGTEXT NULL,
  reviewedBy CHAR(24) NULL,
  reviewedAt DATETIME NULL,
  submittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY submissions_status_idx (status),
  KEY submissions_student_submitted_at_idx (student, submittedAt),
  KEY submissions_problem_submitted_at_idx (problem, submittedAt),
  KEY submissions_reviewed_by_idx (reviewedBy),
  CONSTRAINT fk_submissions_problem FOREIGN KEY (problem) REFERENCES problems(id) ON DELETE CASCADE,
  CONSTRAINT fk_submissions_student FOREIGN KEY (student) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_submissions_reviewed_by FOREIGN KEY (reviewedBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coding_submissions (
  id CHAR(24) NOT NULL,
  attempt CHAR(24) NOT NULL,
  question CHAR(24) NOT NULL,
  studentCode LONGTEXT NOT NULL,
  language ENUM('javascript', 'python', 'java', 'cpp', 'csharp') NOT NULL,
  executionOutput LONGTEXT NULL,
  executionErrors LONGTEXT NULL,
  testsPassed INT NOT NULL DEFAULT 0,
  totalTests INT NOT NULL DEFAULT 0,
  isCorrect BOOLEAN NOT NULL DEFAULT FALSE,
  marksObtained FLOAT NOT NULL DEFAULT 0,
  executedAt DATETIME NULL,
  submittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY coding_submissions_attempt_question_idx (attempt, question),
  KEY coding_submissions_question_correct_idx (question, isCorrect),
  CONSTRAINT fk_coding_submissions_attempt FOREIGN KEY (attempt) REFERENCES attempts(id) ON DELETE CASCADE,
  CONSTRAINT fk_coding_submissions_question FOREIGN KEY (question) REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW teacher_quiz_summary AS
SELECT
  t.id AS teacher_id,
  t.name AS teacher_name,
  q.id AS quiz_id,
  q.title AS quiz_title,
  q.status,
  q.examType,
  COUNT(DISTINCT e.id) AS enrolled_students,
  COUNT(DISTINCT a.id) AS submitted_attempts,
  ROUND(AVG(a.percentage), 2) AS average_percentage
FROM users t
JOIN quizzes q ON q.createdBy = t.id
LEFT JOIN enrollments e ON e.quiz = q.id
LEFT JOIN attempts a ON a.quiz = q.id
WHERE t.role = 'teacher'
GROUP BY t.id, t.name, q.id, q.title, q.status, q.examType;

CREATE OR REPLACE VIEW student_performance_summary AS
SELECT
  s.id AS student_id,
  s.name AS student_name,
  COUNT(DISTINCT e.id) AS enrolled_quizzes,
  COUNT(DISTINCT a.id) AS submitted_attempts,
  ROUND(AVG(a.percentage), 2) AS average_percentage,
  SUM(CASE WHEN a.passed = TRUE THEN 1 ELSE 0 END) AS passed_attempts
FROM users s
LEFT JOIN enrollments e ON e.student = s.id
LEFT JOIN attempts a ON a.student = s.id
WHERE s.role = 'student'
GROUP BY s.id, s.name;

DROP TRIGGER IF EXISTS trg_results_before_insert_grade;
DROP TRIGGER IF EXISTS trg_results_before_update_grade;

DELIMITER $$

CREATE TRIGGER trg_results_before_insert_grade
BEFORE INSERT ON results
FOR EACH ROW
BEGIN
  SET NEW.grade = CASE
    WHEN NEW.percentage >= 90 THEN 'A'
    WHEN NEW.percentage >= 80 THEN 'B'
    WHEN NEW.percentage >= 70 THEN 'C'
    WHEN NEW.percentage >= 60 THEN 'D'
    ELSE 'F'
  END;
END$$

CREATE TRIGGER trg_results_before_update_grade
BEFORE UPDATE ON results
FOR EACH ROW
BEGIN
  SET NEW.grade = CASE
    WHEN NEW.percentage >= 90 THEN 'A'
    WHEN NEW.percentage >= 80 THEN 'B'
    WHEN NEW.percentage >= 70 THEN 'C'
    WHEN NEW.percentage >= 60 THEN 'D'
    ELSE 'F'
  END;
END$$

DELIMITER ;
