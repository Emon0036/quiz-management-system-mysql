const crypto = require('crypto');

const TEACHER_CODE_PREFIX = 'TCH';

function createTeacherCode(byteLength = 4) {
  const safeByteLength = Math.max(4, Number(byteLength) || 4);
  return `${TEACHER_CODE_PREFIX}-${crypto.randomBytes(safeByteLength).toString('hex').toUpperCase()}`;
}

function normalizeTeacherCode(value) {
  return String(value || '').trim().toUpperCase();
}

function formatTeacherName(teacher, fallback = 'Teacher') {
  const name = String(teacher?.name || fallback).trim() || fallback;
  const code = normalizeTeacherCode(teacher?.teacherCode);
  return code ? `${name} (${code})` : name;
}

module.exports = {
  createTeacherCode,
  formatTeacherName,
  normalizeTeacherCode,
};
