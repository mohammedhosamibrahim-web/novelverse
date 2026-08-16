'use strict';

/**
 * Syncs from secondary providers (non-MangaDex).
 * Currently: AniList metadata sync (titles, descriptions, covers, scores).
 * AniList does not host chapter images — it enriches the library metadata
 * and provides covers from s4.anilist.co (served through our proxy).
 */
const { db } = require('../db');
const anilist = require('./anilist');

function normalizeTitle(t) {
  return String(t || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Import popular manga metadata from AniList into the library.
 *  - matches existing rows by title → enriches (score/description/cover)
 *  - otherwise inserts as provider='anilist' metadata entries
 *  Returns { imported, enriched, total }. */
async function syncAniListManga(limit = 100) {
  const perPage = 50;
  const pages = Math.ceil(Math.min(limit, 200) / perPage);
  let imported = 0;
  let enriched = 0;
  let total = 0;

  for (let page = 1; page <= pages; page++) {
    const res = await anilist.getPopularManga(page, perPage);
    for (const m of res.items) {
      total += 1;
      const key = normalizeTitle(m.title);
      // 1. enrich an existing title (any provider)
      const existing = db.prepare('SELECT id FROM manga WHERE lower(title) = ? LIMIT 1').get(key);
      if (existing) {
        db.prepare(
          "UPDATE manga SET score = COALESCE(?, score), description = CASE WHEN description = '' THEN ? ELSE description END, cover_url = CASE WHEN cover_url = '' THEN ? ELSE cover_url END WHERE id = ?"
        ).run(m.score, m.description, m.cover, existing.id);
        enriched += 1;
        continue;
      }
      // 2. skip if already imported from AniList
      const dup = db
        .prepare("SELECT 1 FROM manga WHERE provider = 'anilist' AND provider_id = ?")
        .get(String(m.id));
      if (dup) continue;
      db.prepare(
        `INSERT INTO manga (mangadex_id, title, alt_titles, description, cover_url, author, status, year, last_sync_at, provider, provider_id, score)
         VALUES (NULL, ?, '[]', ?, ?, '', ?, NULL, ?, 'anilist', ?, ?)`
      ).run(m.title, m.description, m.cover, m.status || '', new Date().toISOString(), String(m.id), m.score);
      imported += 1;
    }
  }
  return { imported, enriched, total };
}

module.exports = { syncAniListManga };
