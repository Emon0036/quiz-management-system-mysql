const ExamRosterEntry = require('../models/ExamRosterEntry');
const User = require('../models/User');

const STUDENT_ID_HEADERS = ['studentid', 'student_id', 'student id', 'id', 'roll', 'rollno', 'roll number'];
const STUDENT_NAME_HEADERS = ['studentname', 'student_name', 'student name', 'name', 'full name', 'fullname'];
const SECTION_HEADERS = ['section', 'sec', 'class section', 'class_section', 'group', 'batch'];
const EXAM_NAME_HEADERS = ['examname', 'exam_name', 'exam name', 'exam', 'quiz', 'quizname', 'quiz name'];
const EXAM_DATE_HEADERS = ['date', 'examdate', 'exam_date', 'exam date'];
const ROSTER_EXPORT_MODES = new Set(['all', 'best', 'last']);

function normalizeStudentId(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeStudentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeSection(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function getDocumentId(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
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

function normalizeRosterExportMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ROSTER_EXPORT_MODES.has(mode) ? mode : 'all';
}

function rosterEntryKey(studentId, section = '') {
  return `${normalizeSection(section)}::${normalizeStudentId(studentId)}`;
}

function parseRosterSheet(buffer, fallbackExamName) {
  const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows = splitCsvRows(content);
  if (rows.length < 2) throw new Error('The sheet must include a header row and at least one student row.');

  const delimiter = detectDelimiter(rows[0]);
  const headers = parseCsvLine(rows[0], delimiter);
  const studentIdColumn = findColumn(headers, STUDENT_ID_HEADERS);
  const studentNameColumn = findColumn(headers, STUDENT_NAME_HEADERS);
  const sectionColumn = findColumn(headers, SECTION_HEADERS);
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
      const studentName = normalizeStudentName(studentNameColumn ? sourceData[studentNameColumn] : '');
      const section = normalizeSection(sectionColumn ? sourceData[sectionColumn] : '');
      const examName = String(examNameColumn ? sourceData[examNameColumn] : fallbackExamName || '').trim();
      const examDate = parseFlexibleDate(examDateColumn ? sourceData[examDateColumn] : '');

      return {
        studentId,
        studentName,
        section,
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

function normalizedAttemptNumber(attempt, index = 0) {
  const parsed = Number(attempt?.attemptNumber);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : index + 1;
}

function sortAttempts(attempts) {
  return (Array.isArray(attempts) ? attempts : [])
    .map((attempt, index) => ({
      ...attempt,
      attemptNumber: normalizedAttemptNumber(attempt, index),
    }))
    .sort((left, right) => {
      const numberOrder = normalizedAttemptNumber(left) - normalizedAttemptNumber(right);
      if (numberOrder !== 0) return numberOrder;
      return new Date(left.submittedAt || 0) - new Date(right.submittedAt || 0);
    });
}

function formatAttemptMarks(attempt) {
  if (!attempt) return '';
  if (attempt.status === 'pending-review') return 'Pending';
  const score = Number(attempt.score || 0);
  const totalMarks = Number(attempt.totalMarks || 0);
  const percentage = Number(attempt.percentage || 0);
  return `${score}/${totalMarks} (${percentage}%)`;
}

function formatAttemptNumber(attempt) {
  if (!attempt) return '';
  return normalizedAttemptNumber(attempt);
}

function getAttemptColumnCount(entries) {
  const maxAttemptNumber = (entries || []).reduce((max, entry) => {
    const entryMax = sortAttempts(entry.attempts).reduce(
      (attemptMax, attempt) => Math.max(attemptMax, normalizedAttemptNumber(attempt)),
      0
    );
    return Math.max(max, entryMax);
  }, 0);
  return Math.max(1, maxAttemptNumber);
}

function bestAttempt(attempts) {
  return sortAttempts(attempts)
    .filter((attempt) => attempt.status !== 'pending-review')
    .sort((left, right) => {
      const percentageOrder = Number(right.percentage || 0) - Number(left.percentage || 0);
      if (percentageOrder !== 0) return percentageOrder;
      const scoreOrder = Number(right.score || 0) - Number(left.score || 0);
      if (scoreOrder !== 0) return scoreOrder;
      return new Date(right.submittedAt || 0) - new Date(left.submittedAt || 0);
    })[0] || null;
}

function lastAttempt(attempts) {
  const sorted = sortAttempts(attempts);
  return sorted[sorted.length - 1] || null;
}

function sectionLabel(value) {
  return normalizeSection(value) || 'Unsectioned';
}

function sortRosterEntries(entries) {
  return [...(entries || [])].sort((left, right) => {
    const sectionOrder = sectionLabel(left.section).localeCompare(sectionLabel(right.section), undefined, { sensitivity: 'base' });
    if (sectionOrder !== 0) return sectionOrder;
    return String(left.studentId || '').localeCompare(String(right.studentId || ''), undefined, { numeric: true, sensitivity: 'base' });
  });
}

function buildRosterPreviewRows(entries, quiz = {}, options = {}) {
  const mode = normalizeRosterExportMode(options.mode);
  const sortedEntries = sortRosterEntries(entries);
  const headers = ['Section', 'Student ID', 'Student Name', 'Exam Name', 'Date', 'Attempt Limit'];
  const rows = [];

  if (mode === 'all') {
    const attemptColumnCount = getAttemptColumnCount(sortedEntries);
    for (let attemptNumber = 1; attemptNumber <= attemptColumnCount; attemptNumber += 1) {
      headers.push(
        `Attempt ${attemptNumber} Marks`,
        `Attempt ${attemptNumber} Submitted At`,
        `Attempt ${attemptNumber} Status`
      );
    }

    sortedEntries.forEach((entry) => {
      const attemptsByNumber = new Map(
        sortAttempts(entry.attempts).map((attempt) => [normalizedAttemptNumber(attempt), attempt])
      );
      const row = [
        sectionLabel(entry.section),
        entry.studentId,
        entry.studentName || '',
        entry.examName,
        formatDate(entry.examDate),
        quiz.maxAttempts || '',
      ];

      for (let attemptNumber = 1; attemptNumber <= attemptColumnCount; attemptNumber += 1) {
        const attempt = attemptsByNumber.get(attemptNumber);
        row.push(
          formatAttemptMarks(attempt),
          formatDateTime(attempt?.submittedAt),
          attempt?.status || ''
        );
      }

      rows.push(row);
    });

    return { mode, headers, rows };
  }

  headers.push(
    mode === 'best' ? 'Best Marks' : 'Last Marks',
    mode === 'best' ? 'Best Submitted At' : 'Last Submitted At',
    mode === 'best' ? 'Best Status' : 'Last Status',
    mode === 'best' ? 'Best Attempt Number' : 'Last Attempt Number'
  );

  sortedEntries.forEach((entry) => {
    const attempt = mode === 'best' ? bestAttempt(entry.attempts) : lastAttempt(entry.attempts);
    rows.push([
      sectionLabel(entry.section),
      entry.studentId,
      entry.studentName || '',
      entry.examName,
      formatDate(entry.examDate),
      quiz.maxAttempts || '',
      formatAttemptMarks(attempt),
      formatDateTime(attempt?.submittedAt),
      attempt?.status || '',
      formatAttemptNumber(attempt),
    ]);
  });

  return { mode, headers, rows };
}

function formatRosterCsv(entries, quiz = {}, options = {}) {
  const { headers, rows } = buildRosterPreviewRows(entries, quiz, options);
  const lines = [headers.map(escapeCsv).join(',')];
  rows.forEach((row) => lines.push(row.map(escapeCsv).join(',')));

  return `${lines.join('\r\n')}\r\n`;
}

async function findRosterEntryForQuiz(quizId, studentId, section) {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!normalizedStudentId) return null;
  const filter = { quiz: quizId, studentId: normalizedStudentId };
  if (section !== undefined && section !== null) filter.section = normalizeSection(section);
  return ExamRosterEntry.findOne(filter);
}

async function findRosterEntryForQuizByStudent(quizId, studentUserId) {
  const normalizedUserId = getDocumentId(studentUserId);
  if (!normalizedUserId) return null;
  return ExamRosterEntry.findOne({ quiz: quizId, student: normalizedUserId });
}

async function recordRosterAttempt(entry, attempt) {
  if (!entry || !attempt) return null;

  const attemptId = String(attempt._id || attempt.id || '');
  const studentRef = attempt.student;
  const studentUserId = getDocumentId(studentRef);
  entry.attempts = Array.isArray(entry.attempts) ? entry.attempts : [];

  if (studentUserId && !entry.student) {
    entry.student = studentUserId;
  }

  let record = entry.attempts.find((item) => String(item.attempt) === attemptId);
  if (!record) {
    const submittedAttemptNumber = Number(attempt.attemptNumber);
    const nextAttemptNumber = entry.attempts.reduce(
      (max, item, index) => Math.max(max, normalizedAttemptNumber(item, index)),
      0
    ) + 1;
    record = {
      attempt: attemptId,
      attemptNumber: Number.isFinite(submittedAttemptNumber) && submittedAttemptNumber > 0
        ? Math.floor(submittedAttemptNumber)
        : nextAttemptNumber,
    };
    entry.attempts.push(record);
  } else if (!record.attemptNumber && attempt.attemptNumber) {
    record.attemptNumber = normalizedAttemptNumber(attempt);
  }

  record.submittedAt = attempt.submittedAt || new Date();
  record.status = attempt.status || 'submitted';
  record.score = Number(attempt.score || 0);
  record.totalMarks = Number(attempt.totalMarks || 0);
  record.percentage = Number(attempt.percentage || 0);
  record.passed = Boolean(attempt.passed);
  if (record.status === 'reviewed') record.reviewedAt = new Date();

  if (!entry.studentName && studentUserId) {
    const userName = studentRef?.name || (await User.findById(studentUserId))?.name || '';
    const normalizedName = normalizeStudentName(userName);
    if (normalizedName) entry.studentName = normalizedName;
  }

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
  buildRosterPreviewRows,
  formatRosterCsv,
  findRosterEntryForQuiz,
  findRosterEntryForQuizByStudent,
  normalizeExamName,
  normalizeRosterExportMode,
  normalizeSection,
  normalizeStudentId,
  normalizeStudentName,
  parseRosterSheet,
  recordRosterAttempt,
  rosterEntryKey,
  updateRosterAttemptFromReview,
};
