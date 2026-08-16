'use strict';

const express = require('express');
const { db } = require('../db');
const { optionalAuth } = require('../middleware/auth');
const { cleanText } = require('../middleware/sanitize');

const router = express.Router();

/** GET /api/manga?q=&page=&limit= — paginated catalog from the DB. */
router.get('/', (req, res) => {
  const q = cleanText(req.query.q, 100);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const offset = (page - 1) * limit;

  const where = q ? 'WHERE title LIKE ?' : '';
  const params = q ? [`%${q}%`] : [];

  const total = db.prepare(`SELECT COUNT(*) AS n FROM manga ${where}`).get(...params).n;
  const items = db
    .prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM manga_chapters c WHERE c.manga_id = m.id) AS chapter_count
       FROM manga m ${where} ORDER BY m.last_sync_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

/** GET /api/manga/:id — detail + chapters. */
router.get('/:id', (req, res) => {
  const manga = db.prepare('SELECT * FROM manga WHERE id = ?').get(req.params.id);
  if (!manga) return res.status(404).json({ error: 'Manga not found' });
  try {
    manga.alt_titles = JSON.parse(manga.alt_titles || '[]');
  } catch {
    manga.alt_titles = [];
  }
  const chapters = db
    .prepare('SELECT id, chapter_number, title, volume, lang, external_url, uploaded_at FROM manga_chapters WHERE manga_id = ? ORDER BY chapter_number ASC, lang ASC')
    .all(manga.id);
  res.json({ ...manga, chapters, availableLangs: [...new Set(chapters.map((c) => c.lang))] });
});

module.exports = router;
