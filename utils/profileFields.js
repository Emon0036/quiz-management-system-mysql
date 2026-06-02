function cleanText(value, maxLength = 255) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.slice(0, maxLength);
}

function cleanLongText(value, maxLength = 1200) {
  const text = String(value || '').trim().replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return text.slice(0, maxLength);
}

function buildStudentProfilePayload(body = {}) {
  return {
    name: cleanText(body.name, 100),
    institution: cleanText(body.institution, 180),
    department: cleanText(body.department, 150),
    studentId: cleanText(body.studentId, 80).toUpperCase(),
    section: cleanText(body.section, 80).toUpperCase(),
    batch: cleanText(body.batch, 80),
    phone: cleanText(body.phone, 40),
    bio: cleanLongText(body.bio, 900),
  };
}

function buildTeacherProfilePayload(body = {}) {
  return {
    name: cleanText(body.name, 100),
    institution: cleanText(body.institution, 180),
    department: cleanText(body.department, 150),
    designation: cleanText(body.designation, 120),
    phone: cleanText(body.phone, 40),
    officeLocation: cleanText(body.officeLocation, 150),
    officeHours: cleanText(body.officeHours, 120),
    expertise: cleanLongText(body.expertise, 700),
    bio: cleanLongText(body.bio, 1200),
  };
}

function teacherApplicationMessage(payload) {
  if (!payload.name) return 'Full name is required.';
  if (!payload.department) return 'Department is required for teacher registration.';
  if (!payload.institution) return 'Institution is required for teacher registration.';
  if (!payload.designation) return 'Designation is required for teacher registration.';
  return null;
}

function studentProfileMessage(payload) {
  if (!payload.name) return 'Full name is required.';
  return null;
}

function teacherProfileMessage(payload) {
  if (!payload.name) return 'Full name is required.';
  if (!payload.department) return 'Department is required.';
  if (!payload.institution) return 'Institution is required.';
  if (!payload.designation) return 'Designation is required.';
  return null;
}

module.exports = {
  buildStudentProfilePayload,
  buildTeacherProfilePayload,
  cleanText,
  studentProfileMessage,
  teacherApplicationMessage,
  teacherProfileMessage,
};
