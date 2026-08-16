'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const {
  signToken,
  setAuthCookies,
  clearAuthCookies,
  optionalAuth,
  requireAuth,
} = require('../middleware/auth');
const { setCsrfCookie } = require('../middleware/csrf');
const { cleanText } = require('../middleware/sanitize');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 10;

function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at };
}

/** Fetch a fresh CSRF token (call once on app boot; cookie + value). */
router.get('/csrf', (req, res) => {
  const token = setCsrfCookie(res);
  res.json({ csrfToken: token });
});

/**
 * Register. THE FIRST ACCOUNT EVER REGISTERED AUTOMATICALLY BECOMES
 * SUPER ADMIN with full site control (spec requirement).
 */
router.post('/register', async (req, res, next) => {
  try {
    const username = cleanText(req.body.username, 32);
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');

    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) return res.status(409).json({ error: 'Username or email already taken' });

    const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const role = userCount === 0 ? 'super_admin' : 'user';

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const info = db
      .prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(username, email, hash, role);
    const user = { id: Number(info.lastInsertRowid), username, email, role, created_at: new Date().toISOString() };

    setCsrfCookie(res);
    setAuthCookies(res, user);
    res.status(201).json({ user: publicUser(user), isFirstAccount: userCount === 0 });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = row && (await bcrypt.compare(password, row.password_hash));
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    const user = { id: row.id, username: row.username, email: row.email, role: row.role, created_at: row.created_at };
    setCsrfCookie(res);
    setAuthCookies(res, user);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true });
});

router.get('/me', optionalAuth, (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

module.exports = router;
