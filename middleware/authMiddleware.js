const { removeTabUser } = require('./tabSessionMiddleware');

function isBlocked(user) {
  return Boolean(user && user.accountStatus === 'blocked');
}

function buildLoginRedirect(req) {
  return `/auth/login${req.currentTabId ? `?tab=${encodeURIComponent(req.currentTabId)}` : ''}`;
}

function finishBlockedRequest(req, res) {
  req.user = null;
  req.flash('error', 'Your account has been blocked. Please contact an administrator.');

  if (req.xhr || req.originalUrl.startsWith('/api') || req.accepts(['html', 'json']) === 'json') {
    return res.status(403).json({ error: 'Your account has been blocked.' });
  }

  return res.redirect(buildLoginRedirect(req));
}

function enforceActiveAccount(req, res, next) {
  if (!isBlocked(req.user)) return next();

  removeTabUser(req, req.currentTabId);
  const remainingTabIds = req.session?.tabUsers ? Object.keys(req.session.tabUsers) : [];

  if (req.session && req.session.passport && !req.session.passport.user && remainingTabIds.length) {
    req.session.passport.user = req.session.tabUsers[remainingTabIds[0]];
  }

  if (!remainingTabIds.length && typeof req.logout === 'function') {
    return req.logout((error) => {
      if (error) return next(error);
      return finishBlockedRequest(req, res);
    });
  }

  return finishBlockedRequest(req, res);
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Please log in first.');
  return res.redirect(buildLoginRedirect(req));
}

function ensureAuthenticatedApi(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

function dashboardPathFor(user) {
  if (user.role === 'admin') return '/admin/dashboard';
  if (user.role === 'teacher') {
    return user.teacherStatus === 'pending' || user.teacherStatus === 'rejected'
      ? '/auth/teacher-pending'
      : '/teacher/dashboard';
  }
  return '/student/dashboard';
}

function ensureGuest(req, res, next) {
  if (!req.isAuthenticated()) return next();
  return res.redirect(dashboardPathFor(req.user));
}

function ensureRole(role) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      req.flash('error', 'Please log in first.');
      return res.redirect(buildLoginRedirect(req));
    }

    if (req.user.role !== role) {
      req.flash('error', 'You do not have permission to access that page.');
      return res.status(403).render('error', { title: 'Access denied', message: 'Access denied' });
    }

    if (role === 'teacher' && req.user.teacherStatus && req.user.teacherStatus !== 'approved') {
      return res.redirect('/auth/teacher-pending');
    }

    return next();
  };
}

function ensureAdminOrTeacher(req, res, next) {
  if (!req.isAuthenticated()) {
    req.flash('error', 'Please log in first.');
    return res.redirect(buildLoginRedirect(req));
  }

  if (req.user.role === 'admin') return next();

  if (req.user.role === 'teacher') {
    if (req.user.teacherStatus && req.user.teacherStatus !== 'approved') {
      return res.redirect('/auth/teacher-pending');
    }
    return next();
  }

  req.flash('error', 'You do not have permission to access that page.');
  return res.status(403).render('error', { title: 'Access denied', message: 'Access denied' });
}

module.exports = {
  enforceActiveAccount,
  ensureAuthenticated,
  ensureAuthenticatedApi,
  ensureGuest,
  dashboardPathFor,
  ensureAdmin: ensureRole('admin'),
  ensureTeacher: ensureRole('teacher'),
  ensureStudent: ensureRole('student'),
  ensureAdminOrTeacher,
};
