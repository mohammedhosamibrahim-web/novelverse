'use strict';

const jwt = require('jsonwebtoken');
const { db } = require('../db');
const config = require('../config');

const ROLES = ['super_admin', 'moderator', 'user'];

function signToken(user) {
  return jwt.sign({ id: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

async function loadUser(id) {
  return db
    .prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?')
    .get(id);
}

function setAuthCookies(res, user) {
  const token = signToken(user);
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookies(res) {
  res.clearCookie('token', { path: '/' });
}

/** Require a valid session. Role is loaded fresh from the DB on every
 *  request so admin role changes take effect immediately. */
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await loadUser(payload.id);
    if (!user) throw new Error('user not found');
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

/** Attach req.user when a session exists; anonymous requests pass through. */
async function optionalAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = (await loadUser(payload.id)) || undefined;
  } catch {
    /* ignore invalid token */
  }
  next();
}

/** RBAC gate: require one of the given roles (super_admin / moderator / user). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    next();
  };
}

const isSuperAdmin = requireRole('super_admin');
const isStaff = requireRole('super_admin', 'moderator');

module.exports = {
  ROLES,
  signToken,
  loadUser,
  setAuthCookies,
  clearAuthCookies,
  requireAuth,
  optionalAuth,
  requireRole,
  isSuperAdmin,
  isStaff,
};
