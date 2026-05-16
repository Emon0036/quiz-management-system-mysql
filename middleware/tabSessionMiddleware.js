const crypto = require('crypto');
const User = require('../models/User');

const GUEST_AUTH_ROUTES = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
]);

function getTabId(req) {
  if (req.body && req.body.tab) return String(req.body.tab);
  if (req.query && req.query.tab) return String(req.query.tab);
  if (req.headers['x-tab-session']) return String(req.headers['x-tab-session']);
  return null;
}

function generateTabId() {
  return crypto.randomBytes(8).toString('hex');
}

function isGuestAuthRoute(req) {
  if (!req || !req.path) return false;
  return GUEST_AUTH_ROUTES.has(req.path) || req.path.startsWith('/auth/reset-password/');
}

function canUseLastActiveTab(req) {
  return req && req.method && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
}

function hasExistingTabUsers(req) {
  return Boolean(req.session?.tabUsers && Object.keys(req.session.tabUsers).length);
}

function getRoleUserId(req, roles = expectedRolesForPath(req.path || '')) {
  if (!req.session?.roleUsers || !roles.length) return null;
  const role = roles.find((item) => req.session.roleUsers[item]);
  return role ? req.session.roleUsers[role] : null;
}

function canRecoverFromPassportSession(req) {
  if (isGuestAuthRoute(req)) return false;
  if (!req.session?.passport?.user) return false;
  if (hasExistingTabUsers(req) && !req.session.tabUsers[req.currentTabId]) return false;
  return Boolean(req.currentTabId || canUseLastActiveTab(req));
}

function expectedRolesForPath(path = '') {
  if (path.startsWith('/student') || path.startsWith('/enrollments')) return ['student'];
  if (path.startsWith('/teacher')) return ['teacher'];
  if (path.startsWith('/admin') && !path.startsWith('/admin/setup')) return ['admin'];
  if (path.startsWith('/problems/manage') || path.startsWith('/problems/create')) return ['admin', 'teacher'];
  if (path === '/submissions/submit' || path === '/submissions/history' || /^\/submissions\/[^/]+\/view$/.test(path)) {
    return ['student'];
  }
  if (path.startsWith('/submissions/problem') || /^\/submissions\/[^/]+\/review$/.test(path)) return ['admin', 'teacher'];
  return [];
}

async function findTabUserForRequestRole(req) {
  const roles = expectedRolesForPath(req.path || '');
  const tabEntries = Object.entries(req.session?.tabUsers || {});
  if (!roles.length) return null;

  const roleUserId = getRoleUserId(req, roles);
  if (roleUserId) {
    const matchingTab = tabEntries.find(([, userId]) => String(userId) === String(roleUserId));
    return {
      tabId: matchingTab ? matchingTab[0] : null,
      userId: roleUserId,
      user: await User.findById(roleUserId),
    };
  }

  if (!tabEntries.length) return null;

  const users = await Promise.all(
    tabEntries.map(async ([tabId, userId]) => ({
      tabId,
      userId,
      user: await User.findById(userId),
    }))
  );

  return users.find(({ user }) => user && roles.includes(user.role)) || null;
}

function addTabToInternalUrl(url, tabId) {
  if (!tabId || typeof url !== 'string') return url;
  if (!url.startsWith('/') || url.startsWith('//')) return url;

  try {
    const parsedUrl = new URL(url, 'http://quiz.local');
    if (!parsedUrl.searchParams.has('tab')) {
      parsedUrl.searchParams.set('tab', tabId);
    }
    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return url;
  }
}

function attachTabUser(req, res, next) {
  const tabId = getTabId(req);
  if (!req.session) {
    req.currentTabId = tabId || (isGuestAuthRoute(req) ? generateTabId() : null);
    req.currentTabUserId = null;
    return next();
  }

  req.session.tabUsers = req.session.tabUsers || {};
  req.session.roleUsers = req.session.roleUsers || {};
  req.currentTabUserId = null;

  if (tabId) {
    req.currentTabId = tabId;
    req.session.lastActiveTabId = tabId;
    req.currentTabUserId = req.session.tabUsers[tabId] || null;
  } else if (isGuestAuthRoute(req)) {
    req.currentTabId = generateTabId();
  } else if (
    canUseLastActiveTab(req) &&
    req.session.lastActiveTabId &&
    req.session.tabUsers[req.session.lastActiveTabId]
  ) {
    req.currentTabId = req.session.lastActiveTabId;
    req.currentTabUserId = req.session.tabUsers[req.session.lastActiveTabId];
  }

  next();
}

async function resolveTabUser(req, res, next) {
  const expectedRoles = expectedRolesForPath(req.path || '');
  const roleScopedUserId = expectedRoles.length === 1 ? getRoleUserId(req, expectedRoles) : null;

  if (
    roleScopedUserId &&
    req.currentTabId &&
    req.session?.tabUsers?.[req.currentTabId] &&
    String(req.session.tabUsers[req.currentTabId]) !== String(roleScopedUserId)
  ) {
    const matchingTab = Object.entries(req.session.tabUsers).find(([, userId]) => String(userId) === String(roleScopedUserId));
    req.currentTabId = matchingTab ? matchingTab[0] : generateTabId();
    req.currentTabUserId = roleScopedUserId;
    req.session.tabUsers[req.currentTabId] = roleScopedUserId;
    req.session.lastActiveTabId = req.currentTabId;
  }

  const inferredTabUser = !req.currentTabId ? await findTabUserForRequestRole(req) : null;
  if (inferredTabUser) {
    req.currentTabId = inferredTabUser.tabId || generateTabId();
    req.currentTabUserId = inferredTabUser.userId;
    req.session.lastActiveTabId = req.currentTabId;
  }

  if (!req.currentTabId) {
    if (!canRecoverFromPassportSession(req)) {
      req.user = null;
      req.isAuthenticated = () => false;
      return next();
    }

    req.currentTabId = req.session.lastActiveTabId || generateTabId();
  }

  const scopedUserId =
    roleScopedUserId ||
    req.session?.tabUsers?.[req.currentTabId] ||
    req.currentTabUserId ||
    (canRecoverFromPassportSession(req) ? req.session.passport.user : null);

  if (!scopedUserId) {
    req.user = null;
    req.isAuthenticated = () => false;
    return next();
  }

  if (req.session && req.currentTabId && !req.session.tabUsers?.[req.currentTabId]) {
    req.session.tabUsers = req.session.tabUsers || {};
    req.session.tabUsers[req.currentTabId] = String(scopedUserId);
    req.session.lastActiveTabId = req.currentTabId;
  }

  const currentUserId = req.user && (req.user.id || req.user._id) ? String(req.user.id || req.user._id) : null;
  if (currentUserId !== String(scopedUserId)) {
    req.user = inferredTabUser?.user && String(inferredTabUser.userId) === String(scopedUserId)
      ? inferredTabUser.user
      : await User.findById(scopedUserId);
  }

  if (req.session && req.user?.role) {
    req.session.roleUsers = req.session.roleUsers || {};
    req.session.roleUsers[req.user.role] = String(scopedUserId);
  }

  req.isAuthenticated = () => Boolean(req.user);
  next();
}

function preserveTabInRedirects(req, res, next) {
  const originalRedirect = res.redirect.bind(res);

  res.redirect = (statusOrUrl, maybeUrl) => {
    const hasStatus = typeof statusOrUrl === 'number';
    let targetUrl = hasStatus ? maybeUrl : statusOrUrl;

    if (
      typeof targetUrl === 'string' &&
      req.currentTabId &&
      typeof req.isAuthenticated === 'function' &&
      req.isAuthenticated()
    ) {
      targetUrl = addTabToInternalUrl(targetUrl, req.currentTabId);
    }

    return hasStatus ? originalRedirect(statusOrUrl, targetUrl) : originalRedirect(targetUrl);
  };

  next();
}

function saveTabUser(req, userId, tabId, role) {
  if (!req.session) return;
  req.session.tabUsers = req.session.tabUsers || {};
  req.session.roleUsers = req.session.roleUsers || {};
  req.session.tabUsers[tabId] = userId;
  if (role) req.session.roleUsers[role] = userId;
  req.session.lastActiveTabId = tabId;
  req.currentTabId = tabId;
  req.session.passport = req.session.passport || {};
  req.session.passport.user = userId;
}

function removeTabUser(req, tabId) {
  if (!req.session || !tabId) return;
  req.session.tabUsers = req.session.tabUsers || {};

  const removedUserId = req.session.tabUsers[tabId];
  delete req.session.tabUsers[tabId];

  const remainingIds = Object.values(req.session.tabUsers || {});
  if (removedUserId && req.session.roleUsers && !remainingIds.includes(removedUserId)) {
    Object.keys(req.session.roleUsers).forEach((role) => {
      if (req.session.roleUsers[role] === removedUserId) delete req.session.roleUsers[role];
    });
  }

  if (remainingIds.length) {
    req.session.passport = req.session.passport || {};
    req.session.passport.user = remainingIds[0];
  } else if (req.session.passport) {
    delete req.session.passport.user;
  }

  if (req.session.lastActiveTabId === tabId) {
    req.session.lastActiveTabId = remainingIds.length ? Object.keys(req.session.tabUsers)[0] : null;
  }

  return removedUserId;
}

module.exports = {
  getTabId,
  generateTabId,
  attachTabUser,
  resolveTabUser,
  preserveTabInRedirects,
  saveTabUser,
  removeTabUser,
};
