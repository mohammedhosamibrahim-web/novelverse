'use strict';

const crypto = require('crypto');
const config = require('../config');

const STATE_CHANGING = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Set (or refresh) the CSRF double-submit cookie. */
function setCsrfCookie(res) {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie('csrf', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
  return token;
}

/**
 * Double-submit CSRF protection: the client must echo the value of the
 * `csrf` cookie in the `X-CSRF-Token` header on every state-changing request.
 * (SameSite=Lax cookies are sent on same-site fetches; the header check
 * blocks cross-site request forgery even if a cookie is present.)
 */
function csrfProtect(req, res, next) {
  if (!STATE_CHANGING.includes(req.method)) return next();
  const cookieToken = req.cookies && req.cookies.csrf;
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF validation failed', code: 'CSRF_FAILED' });
  }
  next();
}

module.exports = { csrfProtect, setCsrfCookie };
