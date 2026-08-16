'use strict';

/**
 * Anime routes — backed by AniList GraphQL (metadata + trailer + description).
 * AniList does not host chapter images; it provides rich metadata used for
 * anime browsing and manga enrichment.
 */
const express = require('express');
const anilist = require('../services/anilist');
const { cleanText } = require('../middleware/sanitize');

const router = express.Router();

/** GET /api/anime/search?q=&page= — anime search with description + trailer. */
router.get('/search', async (req, res, next) => {
  try {
    const q = cleanText(req.query.q, 100);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    if (!q) return res.status(400).json({ error: 'q is required' });
    res.json(await anilist.searchMedia(q, 'ANIME', page));
  } catch (err) {
    res.status(502).json({ error: `AniList unavailable: ${err.message}` });
  }
});

/** GET /api/anime/:id — anime detail (includes trailer + description). */
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const anime = await anilist.getMedia(id, 'ANIME');
    if (!anime) return res.status(404).json({ error: 'Anime not found' });
    res.json({ anime });
  } catch (err) {
    res.status(502).json({ error: `AniList unavailable: ${err.message}` });
  }
});

module.exports = router;
