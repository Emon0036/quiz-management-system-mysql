-- Online Quiz Management System - SQL demo queries
-- Use these in the 3-minute SQL query demonstration section.

USE quiz_management_system;

-- 1. JOIN: show quiz attempts with student and teacher details.
SELECT
  a.id AS attempt_id,
  s.name AS student_name,
  q.title AS quiz_title,
  t.name AS teacher_name,
  a.score,
  a.totalMarks,
  a.percentage,
  a.status,
  a.submittedAt
FROM attempts a
JOIN users s ON s.id = a.student
JOIN quizzes q ON q.id = a.quiz
JOIN users t ON t.id = q.createdBy
ORDER BY a.submittedAt DESC
LIMIT 10;

-- 2. AGGREGATION + GROUP BY: quiz performance analytics.
SELECT
  q.id,
  q.title,
  COUNT(a.id) AS total_attempts,
  ROUND(AVG(a.percentage), 2) AS average_percentage,
  MAX(a.percentage) AS highest_percentage,
  SUM(CASE WHEN a.passed = TRUE THEN 1 ELSE 0 END) AS passed_attempts
FROM quizzes q
LEFT JOIN attempts a ON a.quiz = q.id
GROUP BY q.id, q.title
ORDER BY average_percentage DESC;

-- 3. GROUP BY with HAVING: teachers with at least two published exams.
SELECT
  u.id AS teacher_id,
  u.name AS teacher_name,
  COUNT(q.id) AS published_exam_count
FROM users u
JOIN quizzes q ON q.createdBy = u.id
WHERE u.role = 'teacher'
  AND q.status = 'published'
GROUP BY u.id, u.name
HAVING COUNT(q.id) >= 2
ORDER BY published_exam_count DESC;

-- 4. SUBQUERY: students who scored above the average score of their quiz.
SELECT
  s.name AS student_name,
  q.title AS quiz_title,
  a.percentage
FROM attempts a
JOIN users s ON s.id = a.student
JOIN quizzes q ON q.id = a.quiz
WHERE a.percentage > (
  SELECT AVG(a2.percentage)
  FROM attempts a2
  WHERE a2.quiz = a.quiz
)
ORDER BY q.title, a.percentage DESC;

-- 5. CORRELATED SUBQUERY: best attempt for every student in every quiz.
SELECT
  s.name AS student_name,
  q.title AS quiz_title,
  a.attemptNumber,
  a.percentage
FROM attempts a
JOIN users s ON s.id = a.student
JOIN quizzes q ON q.id = a.quiz
WHERE a.percentage = (
  SELECT MAX(a2.percentage)
  FROM attempts a2
  WHERE a2.student = a.student
    AND a2.quiz = a.quiz
)
ORDER BY q.title, a.percentage DESC;

-- 6. VIEW demonstration: teacher dashboard summary.
SELECT *
FROM teacher_quiz_summary
ORDER BY submitted_attempts DESC, enrolled_students DESC;

-- 7. VIEW demonstration: student performance summary.
SELECT *
FROM student_performance_summary
ORDER BY average_percentage DESC;

-- 8. INDEX demonstration: show the optimizer using the attempt lookup index.
EXPLAIN
SELECT *
FROM attempts
WHERE student = 'replace_with_student_id'
  AND quiz = 'replace_with_quiz_id'
ORDER BY submittedAt DESC;

-- 9. TRIGGER demonstration: result grade is generated from percentage.
-- Replace IDs with real values from your database before running.
/*
INSERT INTO results (
  id, student, quiz, attempt, marksObtained, totalMarks, percentage, status
) VALUES (
  'demoresult000000000001',
  'replace_with_student_id',
  'replace_with_quiz_id',
  'replace_with_attempt_id',
  85,
  100,
  85,
  'pass'
);

SELECT id, percentage, grade
FROM results
WHERE id = 'demoresult000000000001';
*/

-- 10. Roster query: verify which students are allowed for an exam.
SELECT
  r.studentId,
  r.studentName,
  r.section,
  q.title AS exam_name,
  t.name AS teacher_name
FROM exam_roster_entries r
JOIN quizzes q ON q.id = r.quiz
JOIN users t ON t.id = r.teacher
ORDER BY q.title, r.section, r.studentId;
