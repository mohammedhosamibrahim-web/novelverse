'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth, isStaff } = require('../middleware/auth');
const { sanitizeComment, cleanText } = require('../middleware/sanitize');

const router = express.Router();

const VALID_TARGETS = ['manga', 'novel', 'manga_chapter', 'novel_chapter'];

/** GET /api/comments?target_type=&target_id=&page= */
router.get('/', async (req, res, next) => {
  try {
    const targetType = cleanText(req.query.target_type, 30);
    const targetId = cleanText(req.query.target_id, 60);
    if (!VALID_TARGETS.includes(targetType) || !targetId) {
      return res.status(400).json({ error: 'target_type and target_id are required' });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const total = (
      await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE target_type = ? AND target_id = ?').get(targetType, targetId)
    ).n;
    const items = await db
      .prepare(
        `SELECT id, user_id, username, content, is_spoiler, created_at
         FROM comments WHERE target_type = ? AND target_id = ?
         ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(targetType, targetId, limit, offset);
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/comments — create (content sanitized; XSS-safe). */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const targetType = cleanText(req.body.target_type, 30);
    const targetId = cleanText(req.body.target_id, 60);
    if (!VALID_TARGETS.includes(targetType) || !targetId) {
      return res.status(400).json({ error: 'target_type and target_id are required' });
    }
    const content = sanitizeComment(req.body.content);
    if (!content) return res.status(400).json({ error: 'Comment cannot be empty' });
    const isSpoiler = req.body.is_spoiler ? 1 : 0;
    const info = await db
      .prepare('INSERT INTO comments (user_id, username, target_type, target_id, content, is_spoiler) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, req.user.username, targetType, targetId, content, isSpoiler);
    const comment = await db
      .prepare('SELECT id, user_id, username, content, is_spoiler, created_at FROM comments WHERE id = ?')
      .get(Number(info.lastInsertRowid));
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/comments/:id — edit own comment (or staff). */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const comment = await db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id !== req.user.id && !['super_admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }
    const content = sanitizeComment(req.body.content);
    if (!content) return res.status(400).json({ error: 'Comment cannot be empty' });
    const isSpoiler = req.body.is_spoiler ? 1 : comment.is_spoiler;
    await db.prepare('UPDATE comments SET content = ?, is_spoiler = ? WHERE id = ?').run(content, isSpoiler, comment.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/comments/:id — own comment, or moderators/admins delete any. */
router.delete('/:id', requireAuth, isStaff, async (req, res, next) => {
  try {
    const comment = await db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id !== req.user.id && !['super_admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }
    await db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
