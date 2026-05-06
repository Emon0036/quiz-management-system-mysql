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

function canRecoverFromPassportSession(req) {
  if (isGuestAuthRoute(req)) return false;
  if (!req.session?.passport?.user) return false;
  if (hasExistingTabUsers(req) && !req.session.tabUsers[req.currentTabId]) return false;
  return Boolean(req.currentTabId || canUseLastActiveTab(req));
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
  if (!req.currentTabId) {
    if (!canRecoverFromPassportSession(req)) {
      req.user = null;
      req.isAuthenticated = () => false;
      return next();
    }

    req.currentTabId = req.session.lastActiveTabId || generateTabId();
  }

  const scopedUserId =
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
    req.user = await User.findById(scopedUserId);
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

function saveTabUser(req, userId, tabId) {
  if (!req.session) return;
  req.session.tabUsers = req.session.tabUsers || {};
  req.session.tabUsers[tabId] = userId;
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
