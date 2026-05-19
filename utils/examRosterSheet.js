const ExamRosterEntry = require('../models/ExamRosterEntry');

const STUDENT_ID_HEADERS = ['studentid', 'student_id', 'student id', 'id', 'roll', 'rollno', 'roll number'];
const EXAM_NAME_HEADERS = ['examname', 'exam_name', 'exam name', 'exam', 'quiz', 'quizname', 'quiz name'];
const EXAM_DATE_HEADERS = ['date', 'examdate', 'exam_date', 'exam date'];

function normalizeStudentId(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactHeader(value) {
  return normalizeHeader(value).replace(/\s+/g, '');
}

function normalizeExamName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumn(headers, candidates) {
  const normalizedCandidates = new Set(candidates.map(normalizeHeader));
  const compactCandidates = new Set(candidates.map(compactHeader));

  return headers.find((header) => {
    const normalized = normalizeHeader(header);
    return normalizedCandidates.has(normalized) || compactCandidates.has(normalized.replace(/\s+/g, ''));
  });
}

function parseCsvLine(line, delimiter) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function splitCsvRows(content) {
  const rows = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '""';
      index += 1;
      continue;
    }

    if (char === '"') quoted = !quoted;

    if ((char === '\n' || char === '\r') && !quoted) {
      if (current.trim()) rows.push(current);
      current = '';
      if (char === '\r' && next === '\n') index += 1;
      continue;
    }

    current += char;
  }

  if (current.trim()) rows.push(current);
  return rows;
}

function detectDelimiter(headerRow) {
  const tabCount = (headerRow.match(/\t/g) || []).length;
  const commaCount = (headerRow.match(/,/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

function parseFlexibleDate(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return null;

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseRosterSheet(buffer, fallbackExamName) {
  const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows = splitCsvRows(content);
  if (rows.length < 2) throw new Error('The sheet must include a header row and at least one student row.');

  const delimiter = detectDelimiter(rows[0]);
  const headers = parseCsvLine(rows[0], delimiter);
  const studentIdColumn = findColumn(headers, STUDENT_ID_HEADERS);
  const examNameColumn = findColumn(headers, EXAM_NAME_HEADERS);
  const examDateColumn = findColumn(headers, EXAM_DATE_HEADERS);

  if (!studentIdColumn) {
    throw new Error('The sheet needs a Student ID column.');
  }

  return rows
    .slice(1)
    .map((row) => {
      const values = parseCsvLine(row, delimiter);
      const sourceData = {};
      headers.forEach((header, index) => {
        sourceData[header || `Column ${index + 1}`] = values[index] || '';
      });

      const studentId = normalizeStudentId(sourceData[studentIdColumn]);
      const examName = String(examNameColumn ? sourceData[examNameColumn] : fallbackExamName || '').trim();
      const examDate = parseFlexibleDate(examDateColumn ? sourceData[examDateColumn] : '');

      return {
        studentId,
        examName,
        examDate,
        sourceData,
      };
    })
    .filter((row) => row.studentId);
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const datePart = date.toISOString().slice(0, 10);
  const timePart = date.toTimeString().slice(0, 5);
  return `${datePart} ${timePart}`;
}

function attemptLabel(attempt) {
  return `A${attempt.attemptNumber || 1}`;
}

function formatMarks(attempts) {
  return (attempts || [])
    .map((attempt) => {
      if (attempt.status === 'pending-review') return `Pending (${attemptLabel(attempt)})`;
      const score = Number(attempt.score || 0);
      const totalMarks = Number(attempt.totalMarks || 0);
      const percentage = Number(attempt.percentage || 0);
      return `${score}/${totalMarks} (${percentage}%) (${attemptLabel(attempt)})`;
    })
    .join(', ');
}

function formatAttemptDates(attempts) {
  return (attempts || [])
    .map((attempt) => `${formatDateTime(attempt.submittedAt)} (${attemptLabel(attempt)})`)
    .join(', ');
}

function formatRosterCsv(entries) {
  const headers = ['Student ID', 'Exam Name', 'Date', 'Marks', 'Attempt Dates'];
  const lines = [headers.map(escapeCsv).join(',')];

  entries.forEach((entry) => {
    const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
    lines.push(
      [
        entry.studentId,
        entry.examName,
        formatDate(entry.examDate),
        formatMarks(attempts),
        formatAttemptDates(attempts),
      ]
        .map(escapeCsv)
        .join(',')
    );
  });

  return `${lines.join('\r\n')}\r\n`;
}

async function findRosterEntryForQuiz(quizId, studentId) {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!normalizedStudentId) return null;
  return ExamRosterEntry.findOne({ quiz: quizId, studentId: normalizedStudentId });
}

async function recordRosterAttempt(entry, attempt) {
  if (!entry || !attempt) return null;

  const attemptId = String(attempt._id || attempt.id || '');
  entry.attempts = Array.isArray(entry.attempts) ? entry.attempts : [];

  let record = entry.attempts.find((item) => String(item.attempt) === attemptId);
  if (!record) {
    record = {
      attempt: attemptId,
      attemptNumber: entry.attempts.length + 1,
    };
    entry.attempts.push(record);
  }

  record.submittedAt = attempt.submittedAt || new Date();
  record.status = attempt.status || 'submitted';
  record.score = Number(attempt.score || 0);
  record.totalMarks = Number(attempt.totalMarks || 0);
  record.percentage = Number(attempt.percentage || 0);
  record.passed = Boolean(attempt.passed);
  if (record.status === 'reviewed') record.reviewedAt = new Date();

  await entry.save();
  return entry;
}

async function updateRosterAttemptFromReview(attempt) {
  if (!attempt) return null;

  const attemptId = String(attempt._id || attempt.id || '');
  const quizId = String(attempt.quiz?._id || attempt.quiz || '');
  if (!attemptId || !quizId) return null;

  const entries = await ExamRosterEntry.find({ quiz: quizId });
  const entry = entries.find((item) =>
    (Array.isArray(item.attempts) ? item.attempts : []).some((record) => String(record.attempt) === attemptId)
  );

  if (!entry) return null;
  return recordRosterAttempt(entry, attempt);
}

module.exports = {
  formatRosterCsv,
  findRosterEntryForQuiz,
  normalizeExamName,
  normalizeStudentId,
  parseRosterSheet,
  recordRosterAttempt,
  updateRosterAttemptFromReview,
};
