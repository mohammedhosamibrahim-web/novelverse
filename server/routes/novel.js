'use strict';

const express = require('express');
const { db } = require('../db');
const { listSources, searchSource } = require('../services/novelSync');
const { cleanText } = require('../middleware/sanitize');

const router = express.Router();

/** GET /api/novels — paginated list from the DB. */
router.get('/', async (req, res, next) => {
  try {
    const q = cleanText(req.query.q, 100);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 24));
    const offset = (page - 1) * limit;
    const where = q ? 'WHERE title LIKE ?' : '';
    const params = q ? [`%${q}%`] : [];
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM novels ${where}`).get(...params)).n;
    const items = await db
      .prepare(
        `SELECT n.*, (SELECT COUNT(*) FROM novel_chapters c WHERE c.novel_id = n.id) AS chapter_count
         FROM novels n ${where} ORDER BY n.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/novels/sources — enabled scrape sources. */
router.get('/sources', async (req, res, next) => {
  try {
    const sources = await listSources();
    res.json({ sources: sources.filter((s) => s.enabled) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/novels/search?source=&q= — live search against a source. */
router.get('/search', async (req, res, next) => {
  try {
    const sourceId = cleanText(req.query.source, 50);
    const q = cleanText(req.query.q, 100);
    if (!sourceId || !q) return res.status(400).json({ error: 'source and q are required' });
    res.json(await searchSource(sourceId, q));
  } catch (err) {
    if (err.code === 'SOURCE_UNAVAILABLE') return res.status(404).json({ error: err.message });
    next(err);
  }
});

/** GET /api/novels/:id — detail + toc. */
router.get('/:id', async (req, res, next) => {
  try {
    const novel = await db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id);
    if (!novel) return res.status(404).json({ error: 'Novel not found' });
    const chapters = await db
      .prepare('SELECT id, chapter_index, title, fetched_at FROM novel_chapters WHERE novel_id = ? ORDER BY chapter_index ASC')
      .all(novel.id);
    res.json({ ...novel, chapters });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
