const validator = require('validator');
const Admin = require('../models/Admin');
const User = require('../models/User');

async function buildDashboardData() {
  const [students, teachers, admins, pendingTeachers, rejectedTeachers] = await Promise.all([
    User.find({ role: 'student' }).sort('-createdAt'),
    User.find({ role: 'teacher', teacherStatus: { $ne: 'pending' } }).sort('-createdAt'),
    User.find({ role: 'admin' }).sort('-createdAt'),
    User.find({ role: 'teacher', teacherStatus: 'pending' }).sort('-createdAt'),
    User.find({ role: 'teacher', teacherStatus: 'rejected' }).sort('-createdAt'),
  ]);

  return {
    students,
    teachers,
    admins,
    pendingTeachers,
    rejectedTeachers,
    stats: {
      students: students.filter((student) => student.accountStatus !== 'blocked').length,
      teachers: teachers.filter((teacher) => teacher.teacherStatus === 'approved' && teacher.accountStatus !== 'blocked').length,
      pendingTeachers: pendingTeachers.length,
      admins: admins.length,
      blockedUsers: students.filter((student) => student.accountStatus === 'blocked').length
        + teachers.filter((teacher) => teacher.accountStatus === 'blocked').length,
    },
  };
}

function validateAdminInput({ name, email, password }) {
  if (!name || !email || !password) return 'Name, email, and password are required.';
  if (!validator.isEmail(email)) return 'Please enter a valid email address.';
  if (password.length < 6) return 'Password must be at least 6 characters.';
  return null;
}

async function createAdminAccount({ name, email, password, createdBy }) {
  const normalizedEmail = email.toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) throw new Error('An account already exists with that email.');

  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    role: 'admin',
    teacherStatus: 'none',
  });

  await Admin.create({ user: user._id, createdBy });
  return user;
}

function ensureManageableUser(user) {
  return Boolean(user && ['student', 'teacher'].includes(user.role));
}

exports.showSetup = async (req, res) => {
  const adminCount = await User.countDocuments({ role: 'admin' });
  if (adminCount > 0) {
    req.flash('error', 'Admin setup is already complete. Please log in.');
    return res.redirect('/auth/login');
  }
  return res.render('admin/setup', { title: 'Create first admin' });
};

exports.setup = async (req, res) => {
  const adminCount = await User.countDocuments({ role: 'admin' });
  if (adminCount > 0) {
    req.flash('error', 'Admin setup is already complete. Please log in.');
    return res.redirect('/auth/login');
  }

  const message = validateAdminInput(req.body);
  if (message) {
    req.flash('error', message);
    return res.redirect('/admin/setup');
  }

  try {
    await createAdminAccount(req.body);
    req.flash('success', 'First admin created. Please log in.');
    return res.redirect('/auth/login');
  } catch (error) {
    req.flash('error', error.message);
    return res.redirect('/admin/setup');
  }
};

exports.dashboard = async (req, res) => {
  const data = await buildDashboardData();
  res.render('admin/dashboard', { title: 'Admin Dashboard', ...data });
};

exports.createAdmin = async (req, res) => {
  const message = validateAdminInput(req.body);
  if (message) {
    req.flash('error', message);
    return res.redirect('/admin/dashboard');
  }

  try {
    await createAdminAccount({ ...req.body, createdBy: req.user._id });
    req.flash('success', 'Admin account created.');
  } catch (error) {
    req.flash('error', error.message);
  }
  return res.redirect('/admin/dashboard');
};

exports.approveTeacher = async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user || user.role !== 'teacher') {
    req.flash('error', 'Teacher request not found.');
    return res.redirect('/admin/dashboard');
  }

  user.teacherStatus = 'approved';
  user.approvedBy = req.user._id;
  user.approvedAt = new Date();
  await user.save();

  req.flash('success', `${user.name} can now create and manage quizzes.`);
  return res.redirect('/admin/dashboard');
};

exports.rejectTeacher = async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user || user.role !== 'teacher') {
    req.flash('error', 'Teacher request not found.');
    return res.redirect('/admin/dashboard');
  }

  user.teacherStatus = 'rejected';
  user.approvedBy = undefined;
  user.approvedAt = undefined;
  await user.save();

  req.flash('success', `${user.name}'s teacher request was rejected.`);
  return res.redirect('/admin/dashboard');
};

exports.grantTeacherByEmail = async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!validator.isEmail(email)) {
    req.flash('error', 'Please enter a valid email address.');
    return res.redirect('/admin/dashboard');
  }

  const user = await User.findOne({ email });
  if (!user) {
    req.flash('error', 'No user exists with that email.');
    return res.redirect('/admin/dashboard');
  }
  if (user.role === 'admin') {
    req.flash('error', 'Admin accounts cannot be changed into teachers.');
    return res.redirect('/admin/dashboard');
  }

  user.role = 'teacher';
  user.teacherStatus = 'approved';
  user.approvedBy = req.user._id;
  user.approvedAt = new Date();
  await user.save();

  req.flash('success', `${user.email} now has approved teacher access.`);
  return res.redirect('/admin/dashboard');
};

exports.blockUser = async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!ensureManageableUser(user)) {
    req.flash('error', 'Only student and teacher accounts can be blocked.');
    return res.redirect('/admin/dashboard');
  }

  if (user.accountStatus === 'blocked') {
    req.flash('error', `${user.name} is already blocked.`);
    return res.redirect('/admin/dashboard');
  }

  user.accountStatus = 'blocked';
  user.blockedBy = req.user._id;
  user.blockedAt = new Date();
  await user.save();

  req.flash('success', `${user.name} has been blocked from accessing the platform.`);
  return res.redirect('/admin/dashboard');
};

exports.unblockUser = async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!ensureManageableUser(user)) {
    req.flash('error', 'Only student and teacher accounts can be unblocked.');
    return res.redirect('/admin/dashboard');
  }

  if (user.accountStatus !== 'blocked') {
    req.flash('error', `${user.name} is not blocked.`);
    return res.redirect('/admin/dashboard');
  }

  user.accountStatus = 'active';
  user.blockedBy = undefined;
  user.blockedAt = undefined;
  await user.save();

  req.flash('success', `${user.name} can access the platform again.`);
  return res.redirect('/admin/dashboard');
};
