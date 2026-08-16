'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { cleanText } = require('../middleware/sanitize');

const router = express.Router();
router.use(requireAuth);

// ── Bookmarks ───────────────────────────────────────────────────────────

/** GET /api/user/bookmarks */
router.get('/bookmarks', (req, res) => {
  const items = db
    .prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY id DESC LIMIT 200')
    .all(req.user.id);
  res.json({ items });
});

/** POST /api/user/bookmarks { target_type, target_id } */
router.post('/bookmarks', (req, res) => {
  const targetType = cleanText(req.body.target_type, 30);
  const targetId = cleanText(req.body.target_id, 60);
  if (!['manga', 'novel'].includes(targetType) || !targetId) {
    return res.status(400).json({ error: 'target_type (manga|novel) and target_id are required' });
  }
  db.prepare(
    'INSERT OR IGNORE INTO bookmarks (user_id, target_type, target_id) VALUES (?, ?, ?)'
  ).run(req.user.id, targetType, targetId);
  res.status(201).json({ ok: true });
});

/** DELETE /api/user/bookmarks?target_type=&target_id= */
router.delete('/bookmarks', (req, res) => {
  const targetType = cleanText(req.query.target_type, 30);
  const targetId = cleanText(req.query.target_id, 60);
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND target_type = ? AND target_id = ?').run(
    req.user.id,
    targetType,
    targetId
  );
  res.json({ ok: true });
});

// ── Reading history ──────────────────────────────────────────────────────

/** GET /api/user/history — most recently read items. */
router.get('/history', (req, res) => {
  const items = db
    .prepare('SELECT * FROM reading_history WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100')
    .all(req.user.id);
  res.json({ items });
});

/** POST /api/user/history { target_type, target_id, chapter_id, progress } */
router.post('/history', (req, res) => {
  const targetType = cleanText(req.body.target_type, 30);
  const targetId = cleanText(req.body.target_id, 60);
  const chapterId = cleanText(req.body.chapter_id, 60);
  const progress = Math.min(1, Math.max(0, parseFloat(req.body.progress) || 0));
  if (!targetType || !targetId) return res.status(400).json({ error: 'target_type and target_id are required' });
  db.prepare(
    `INSERT INTO reading_history (user_id, target_type, target_id, chapter_id, progress)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET
       chapter_id = excluded.chapter_id, progress = excluded.progress, updated_at = datetime('now')`
  ).run(req.user.id, targetType, targetId, chapterId, progress);
  res.json({ ok: true });
});

/** GET /api/user/profile — account overview (also used by the profile page). */
router.get('/profile', (req, res) => {
  const bookmarkCount = db.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?').get(req.user.id).n;
  const historyCount = db.prepare('SELECT COUNT(*) AS n FROM reading_history WHERE user_id = ?').get(req.user.id).n;
  const commentCount = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?').get(req.user.id).n;
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      created_at: req.user.created_at,
    },
    counts: { bookmarkCount, historyCount, commentCount },
  });
});

module.exports = router;
