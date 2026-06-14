require('dotenv').config();

const assert = require('assert');
const http = require('http');
const { URL, URLSearchParams } = require('url');

const { app, closeAppResources, configureApp } = require('../app');
const { connectMySql } = require('../config/database');
const Admin = require('../models/Admin');
const Attempt = require('../models/Attempt');
const Enrollment = require('../models/Enrollment');
const GlobalLeaderboard = require('../models/GlobalLeaderboard');
const Leaderboard = require('../models/Leaderboard');
const Problem = require('../models/Problem');
const Progress = require('../models/Progress');
const Question = require('../models/Question');
const Quiz = require('../models/Quiz');
const Result = require('../models/Result');
const Submission = require('../models/Submission');
const User = require('../models/User');

const PASSWORD = 'Smoke@12345';

function listen(serverApp) {
  return new Promise((resolve) => {
    const server = serverApp.listen(0, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    return server.close((error) => (error ? reject(error) : resolve()));
  });
}

function formBody(values) {
  const body = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => body.append(key, value));
  return body;
}

function expectStatus(response, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert(
    allowed.includes(response.statusCode),
    `${label} expected ${allowed.join(' or ')}, got ${response.statusCode}\n${response.body.slice(0, 500)}`
  );
}

function pathWithTab(path, tabId) {
  if (!tabId) return path;
  const url = new URL(path, 'http://smoke.local');
  if (!url.searchParams.has('tab')) url.searchParams.set('tab', tabId);
  return `${url.pathname}${url.search}${url.hash}`;
}

class SmokeClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.tabId = '';
  }

  rememberCookies(setCookieHeaders) {
    const headers = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : setCookieHeaders
        ? [setCookieHeaders]
        : [];

    headers.forEach((cookie) => {
      const [pair] = String(cookie).split(';');
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex <= 0) return;
      this.cookies.set(pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1));
    });
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  request(method, path, options = {}) {
    const url = new URL(path, this.baseUrl);
    const isJson = options.json !== undefined;
    const body = isJson
      ? JSON.stringify(options.json)
      : options.form
        ? options.form.toString()
        : options.body || '';

    const headers = {
      ...(options.headers || {}),
    };

    if (body) {
      headers['Content-Length'] = Buffer.byteLength(body);
      headers['Content-Type'] = isJson ? 'application/json' : 'application/x-www-form-urlencoded';
    }

    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          method,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          headers,
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            this.rememberCookies(res.headers['set-cookie']);
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async login(email, expectedRedirectPrefix) {
    const response = await this.request('POST', '/auth/login', {
      form: formBody({ email, password: PASSWORD }),
    });
    expectStatus(response, 302, `login ${email}`);

    const location = response.headers.location || '';
    assert(location.startsWith(expectedRedirectPrefix), `login redirected to ${location}`);
    const redirectUrl = new URL(location, this.baseUrl);
    this.tabId = redirectUrl.searchParams.get('tab') || '';

    const landing = await this.request('GET', location);
    expectStatus(landing, 200, `login landing ${email}`);
    return landing;
  }

  get(path) {
    return this.request('GET', pathWithTab(path, this.tabId));
  }

  post(path, form) {
    return this.request('POST', pathWithTab(path, this.tabId), { form });
  }
}

async function createFixtures() {
  const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const teacher = await User.create({
    name: 'Smoke Teacher',
    email: `smoke-teacher-${stamp}@example.test`,
    password: PASSWORD,
    role: 'teacher',
    teacherStatus: 'approved',
    accountStatus: 'active',
    department: 'Quality',
    institution: 'Smoke Institute',
    designation: 'Teacher',
    phone: '0000000000',
  });

  const student = await User.create({
    name: 'Smoke Student',
    email: `smoke-student-${stamp}@example.test`,
    password: PASSWORD,
    role: 'student',
    teacherStatus: 'none',
    accountStatus: 'active',
  });

  const admin = await User.create({
    name: 'Smoke Admin',
    email: `smoke-admin-${stamp}@example.test`,
    password: PASSWORD,
    role: 'admin',
    teacherStatus: 'none',
    accountStatus: 'active',
  });
  await Admin.create({ user: admin._id, permissions: { manageUsers: true, manageTeachers: true, manageAdmins: true } });
  await Progress.create({ student: student._id });
  await GlobalLeaderboard.create({ student: student._id });

  const quiz = await Quiz.create({
    title: `Smoke Quiz ${stamp}`,
    description: 'Temporary smoke-test quiz',
    category: 'Smoke Tests',
    examType: 'quiz',
    difficulty: 'Easy',
    duration: 5,
    passingMarks: 50,
    maxAttempts: 3,
    totalMarks: 0,
    createdBy: teacher._id,
    questions: [],
    status: 'published',
  });
  const question = await Question.create({
    quiz: quiz._id,
    questionText: 'What is 2 + 2?',
    type: 'multiple-choice',
    options: ['3', '4'],
    correctAnswer: '4',
    explanation: '2 + 2 equals 4.',
    marks: 1,
  });
  quiz.questions = [question._id];
  quiz.totalMarks = 1;
  await quiz.save();
  await Leaderboard.create({ quiz: quiz._id, entries: [] });

  const problem = await Problem.create({
    title: `Smoke Problem ${stamp}`,
    description: 'Return the input value.',
    inputFormat: 'One value',
    outputFormat: 'The same value',
    sampleInput: '5',
    sampleOutput: '5',
    testCases: [{ input: '5', expectedOutput: '5' }],
    difficulty: 'Easy',
    createdBy: teacher._id,
  });

  return { admin, problem, question, quiz, stamp, student, teacher };
}

async function cleanupFixtures(fixtures) {
  if (!fixtures) return;
  const { admin, problem, quiz, student, teacher } = fixtures;

  await Submission.deleteMany({ student: student._id });
  await Problem.deleteMany({ _id: problem._id });
  await Result.deleteMany({ student: student._id });
  await Attempt.deleteMany({ student: student._id });
  await Enrollment.deleteMany({ student: student._id });
  await GlobalLeaderboard.deleteMany({ student: student._id });
  await Progress.deleteMany({ student: student._id });
  await Leaderboard.deleteMany({ quiz: quiz._id });
  await Question.deleteMany({ quiz: quiz._id });
  await Quiz.deleteMany({ _id: quiz._id });
  await Admin.deleteMany({ user: admin._id });
  await User.deleteMany({ _id: { $in: [admin._id, student._id, teacher._id] } });
}

async function runSmokeChecks(baseUrl, fixtures) {
  const guest = new SmokeClient(baseUrl);
  for (const path of ['/', '/about', '/features', '/pricing', '/help', '/contact', '/terms', '/privacy', '/auth/login', '/auth/register', '/problems']) {
    expectStatus(await guest.request('GET', path), 200, `GET ${path}`);
  }

  const student = new SmokeClient(baseUrl);
  await student.login(fixtures.student.email, '/student/dashboard');

  expectStatus(await student.get('/student/profile'), 200, 'student profile');
  expectStatus(await student.get('/enrollments/browse'), 200, 'browse exams');

  const enrollResponse = await student.post(`/enrollments/${fixtures.quiz._id}/enroll`, formBody({}));
  expectStatus(enrollResponse, 302, 'enroll in quiz');
  expectStatus(await student.get('/enrollments/my-quizzes'), 200, 'my exams');
  expectStatus(await student.get(`/student/quizzes/${fixtures.quiz._id}/take`), 200, 'take quiz');

  const submitResponse = await student.post(
    `/student/quizzes/${fixtures.quiz._id}/submit`,
    formBody({
      [`answers[${fixtures.question._id}]`]: '4',
      timeSpent: '12',
      autoSubmitted: '0',
      autoSubmitReason: '',
    })
  );
  expectStatus(submitResponse, 302, 'submit quiz');
  assert(submitResponse.headers.location?.startsWith('/student/results/'), 'quiz submit should redirect to result');
  expectStatus(await student.get(submitResponse.headers.location), 200, 'quiz result');
  expectStatus(await student.get('/student/history'), 200, 'student history');
  expectStatus(await student.get('/student/reviews'), 200, 'student reviews');
  expectStatus(await student.get('/enrollments/progress'), 200, 'student progress');
  expectStatus(await student.get('/enrollments/leaderboard'), 200, 'global leaderboard');
  expectStatus(await student.get(`/student/quizzes/${fixtures.quiz._id}/leaderboard`), 200, 'quiz leaderboard');

  expectStatus(await student.get(`/problems/${fixtures.problem._id}`), 200, 'problem detail');
  const submitCode = await student.request('POST', pathWithTab('/submissions/submit', student.tabId), {
    json: {
      problemId: fixtures.problem._id,
      language: 'javascript',
      code: 'console.log("ok");',
    },
  });
  expectStatus(submitCode, 200, 'submit code');
  const submissionId = JSON.parse(submitCode.body).submissionId;
  assert(submissionId, 'code submission should return an id');
  expectStatus(await student.get('/submissions/history'), 200, 'submission history');
  expectStatus(await student.get(`/submissions/${submissionId}/view`), 200, 'student submission view');

  const teacher = new SmokeClient(baseUrl);
  await teacher.login(fixtures.teacher.email, '/teacher/dashboard');
  expectStatus(await teacher.get('/teacher/profile'), 200, 'teacher profile');
  expectStatus(await teacher.get('/teacher/quizzes'), 200, 'teacher quizzes');
  expectStatus(await teacher.get(`/teacher/quizzes/${fixtures.quiz._id}/edit`), 200, 'edit quiz');
  expectStatus(await teacher.get(`/teacher/quizzes/${fixtures.quiz._id}/attempts`), 200, 'quiz attempts');
  expectStatus(await teacher.get(`/teacher/quizzes/${fixtures.quiz._id}/analytics`), 200, 'quiz analytics');
  expectStatus(await teacher.get(`/teacher/quizzes/${fixtures.quiz._id}/leaderboard`), 200, 'teacher quiz leaderboard');
  expectStatus(await teacher.get('/teacher/reviews'), 200, 'teacher reviews');
  expectStatus(await teacher.get('/problems/manage'), 200, 'problem management');
  expectStatus(await teacher.get(`/submissions/problem/${fixtures.problem._id}`), 200, 'problem submissions');
  expectStatus(await teacher.get(`/submissions/${submissionId}/review`), 200, 'review submission');

  const reviewResponse = await teacher.post(
    `/submissions/${submissionId}/review?_method=PATCH`,
    formBody({
      marksAwarded: '1',
      teacherComment: 'Looks good.',
      correctedCode: 'console.log("ok");',
    })
  );
  expectStatus(reviewResponse, 302, 'update code review');

  const admin = new SmokeClient(baseUrl);
  await admin.login(fixtures.admin.email, '/admin/dashboard');
  expectStatus(await admin.get('/admin/dashboard'), 200, 'admin dashboard');
}

async function main() {
  let server = null;
  let fixtures = null;

  try {
    await connectMySql();
    fixtures = await createFixtures();
    configureApp();
    server = await listen(app);
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await runSmokeChecks(baseUrl, fixtures);
    console.log('Smoke test passed: public, student, teacher, admin, quiz, and coding-problem flows are reachable.');
  } finally {
    await closeServer(server);
    await cleanupFixtures(fixtures);
    await closeAppResources();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
