'use strict';

/**
 * MangaDex API integration + database sync.
 * Uses the public api.mangadex.org REST API (https://api.mangadex.org/docs/).
 *
 * Sync strategy (bandwidth/rate-limit friendly):
 *  - Bulk sync stores chapter METADATA only (no image resolution) → cheap.
 *  - Chapter image pages are resolved LAZILY on first read via
 *    resolveChapterPages() (at-home server), and the stored base URL is
 *    re-resolved on the fly when an image fails → self-healing readers.
 *
 * Sync modes:
 *  - 'daily'   : automated DAILY bulk — up to MANGADEX_DAILY_LIMIT NEW works
 *                with ALL their chapters (spec: 50–100 works/day).
 *  - 'ongoing' : track ongoing/hiatus series — pull new chapters as soon as
 *                they are uploaded (runs every MANGADEX_ONGOING_INTERVAL_MS).
 *  - 'popular' / 'latest' : manual deep pulls of those lists.
 *  - 'full'    : scheduled refresh (popular 1p + latest 1p + ongoing batch).
 *  - 'refresh' : refresh chapter lists of existing manga (ongoing first).
 */
const { db, getSetting } = require('../db');
const config = require('../config');

const API = config.mangadex.baseUrl;
const MAX_FEED_PAGE = 500; // MangaDex feed limit per request
const MAX_FEED_TOTAL = 2000; // safety cap for very long series

const syncStatus = {
  running: false,
  lastRun: null,
  lastError: null,
  lastMode: null,
  lastCount: 0,
  progress: null, // { total, done, current } for the admin progress bar
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Active API base — switches to the configured alternative source when the
 *  admin enables the Alternative API toggle (any MangaDex-compatible API). */
async function apiBase() {
  if ((await getSetting('content_source', 'mangadex')) === 'alternative') {
    const alt = await getSetting('alt_api_base', '');
    if (alt && alt.trim()) return alt.trim().replace(/\/+$/, '');
  }
  return API;
}

/** MangaDex API request with retries for transient network errors/5xx.
 *  Base URL follows the admin's content-source switch. */
async function mdFetch(path, retries = 3) {
  const base = await apiBase();
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(base + path, {
        headers: { 'User-Agent': config.mangadex.userAgent, Accept: 'application/json' },
      });
    } catch {
      if (attempt < retries) {
        await delay(1000 * (attempt + 1));
        continue;
      }
      throw new Error(`MangaDex network error for ${path}`);
    }
    if (res.ok) return res.json();
    if (res.status >= 500 && attempt < retries) {
      await delay(1000 * (attempt + 1));
      continue;
    }
    throw new Error(`MangaDex ${res.status} ${res.statusText} for ${path}`);
  }
  throw new Error(`MangaDex request failed for ${path}`);
}

/** Build a query string with duplicate keys (e.g. includes[]). */
function buildParams(entries) {
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.append(k, String(v));
  return params;
}

function coverUrl(manga) {
  const rel = (manga.relationships || []).find((r) => r.type === 'cover_art');
  if (rel && rel.attributes && rel.attributes.fileName) {
    return `https://uploads.mangadex.org/covers/${manga.id}/${rel.attributes.fileName}.256.jpg`;
  }
  return '';
}

function firstTitle(manga) {
  const title = (manga.attributes && manga.attributes.title) || {};
  return title.en || Object.values(title)[0] || 'Untitled';
}

function authorName(manga) {
  const rel = (manga.relationships || []).find((r) => r.type === 'author');
  return rel && rel.attributes ? rel.attributes.name || '' : '';
}

async function searchManga(query, limit = 20, offset = 0) {
  const params = buildParams([
    ['includes[]', 'cover_art'],
    ['includes[]', 'author'],
    ['limit', limit],
    ['offset', offset],
  ]);
  if (query) params.set('title', query);
  const data = await mdFetch(`/manga?${params}`);
  return data.data || [];
}

/** Most-followed manga (all-time popular). */
async function getPopular(limit = 50, offset = 0) {
  const params = buildParams([
    ['includes[]', 'cover_art'],
    ['includes[]', 'author'],
    ['limit', limit],
    ['offset', offset],
    ['order[followedCount]', 'desc'],
  ]);
  const data = await mdFetch(`/manga?${params}`);
  return data.data || [];
}

/** Recently-updated manga (catches new chapters on ongoing series). */
async function getLatest(limit = 50, offset = 0) {
  const params = buildParams([
    ['includes[]', 'cover_art'],
    ['includes[]', 'author'],
    ['limit', limit],
    ['offset', offset],
    ['order[latestUploadedChapter]', 'desc'],
  ]);
  const data = await mdFetch(`/manga?${params}`);
  return data.data || [];
}

/** Top-rated / hidden gems (bayesian rating order — surfaces underrated gems). */
async function getTopRated(limit = 50, offset = 0) {
  const params = buildParams([
    ['includes[]', 'cover_art'],
    ['includes[]', 'author'],
    ['limit', limit],
    ['offset', offset],
    ['order[rating]', 'desc'],
  ]);
  const data = await mdFetch(`/manga?${params}`);
  return data.data || [];
}

async function upsertManga(md) {
  const existing = await db.prepare('SELECT id FROM manga WHERE mangadex_id = ?').get(md.id);
  const record = {
    mangadex_id: md.id,
    title: firstTitle(md),
    alt_titles: JSON.stringify((md.attributes && md.attributes.altTitles) || []),
    description: (md.attributes && md.attributes.description && (md.attributes.description.en || Object.values(md.attributes.description)[0])) || '',
    cover_url: coverUrl(md),
    author: authorName(md),
    status: (md.attributes && md.attributes.status) || '',
    year: (md.attributes && md.attributes.year) || null,
    last_sync_at: new Date().toISOString(),
  };
  if (existing) {
    await db
      .prepare(
        `UPDATE manga SET title=@title, alt_titles=@alt_titles, description=@description,
         cover_url=@cover_url, author=@author, status=@status, year=@year, last_sync_at=@last_sync_at,
         provider='mangadex', provider_id=@mangadex_id
         WHERE id=@id`
      )
      .run({ ...record, id: existing.id });
    return existing.id;
  }
  const info = await db
    .prepare(
      `INSERT INTO manga (mangadex_id, title, alt_titles, description, cover_url, author, status, year, last_sync_at, provider, provider_id)
       VALUES (@mangadex_id, @title, @alt_titles, @description, @cover_url, @author, @status, @year, @last_sync_at, 'mangadex', @mangadex_id)`
    )
    .run(record);
  return Number(info.lastInsertRowid);
}

/**
 * Sync chapter METADATA for one manga (cheap — no image resolution).
 * Paginated feed so very long series (1000+ chapters) are fully covered.
 * Incremental upsert; pages resolve lazily on first read.
 */
async function syncMangaChapters(mangaId, mangadexId, lang = 'en') {
  const upsert = db.prepare(
    `INSERT INTO manga_chapters (manga_id, chapter_number, title, volume, lang, pages_json, external_url, uploaded_at, md_chapter_id)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?)
     ON CONFLICT (manga_id, chapter_number, lang) DO UPDATE SET
       title = excluded.title, external_url = excluded.external_url,
       uploaded_at = excluded.uploaded_at, md_chapter_id = excluded.md_chapter_id`
  );
  let count = 0;
  for (let offset = 0; offset < MAX_FEED_TOTAL; offset += MAX_FEED_PAGE) {
    const params = buildParams([
      ['translatedLanguage[]', lang],
      ['order[chapter]', 'asc'],
      ['includes[]', 'scanlation_group'],
      ['limit', MAX_FEED_PAGE],
      ['offset', offset],
    ]);
    const feed = await mdFetch(`/manga/${mangadexId}/feed?${params}`);
    const batch = feed.data || [];
    if (batch.length === 0) break;
    for (const ch of batch) {
      const attrs = ch.attributes || {};
      await upsert.run(
        mangaId,
        parseFloat(attrs.chapter) || 0,
        attrs.title || '',
        attrs.volume || null,
        lang,
        attrs.externalUrl || null,
        attrs.publishAt || null,
        ch.id
      );
      count += 1;
    }
    if (batch.length < MAX_FEED_PAGE) break;
  }
  return count;
}

/**
 * Lazily resolve a chapter's image pages via the at-home server.
 * Stores pages_json as [{ h: hash, f: filename, b: baseUrl }] so the image
 * proxy can re-resolve the base URL if it rotates (self-healing).
 * Returns the page entries, or null when the chapter cannot be resolved.
 */
async function resolveChapterPages(chapterId) {
  const chapter = await db.prepare('SELECT * FROM manga_chapters WHERE id = ?').get(chapterId);
  if (!chapter || !chapter.md_chapter_id) return null;
  let home;
  try {
    home = await mdFetch(`/at-home/server/${chapter.md_chapter_id}`);
  } catch {
    return null;
  }
  if (!home || home.result !== 'ok' || !home.chapter) return null;
  const filenames = home.chapter.dataSaver && home.chapter.dataSaver.length ? home.chapter.dataSaver : home.chapter.data || [];
  const pages = filenames.map((f) => ({ h: home.chapter.hash, f, b: home.baseUrl }));
  if (pages.length === 0) return null;
  await db.prepare('UPDATE manga_chapters SET pages_json = ? WHERE id = ?').run(JSON.stringify(pages), chapterId);
  return pages;
}

/** Normalize stored pages_json into an array of page entries. */
function normalizePages(pagesJson) {
  let raw = [];
  try {
    raw = JSON.parse(pagesJson || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === 'string') return { u: entry }; // legacy absolute URL
    if (entry && typeof entry === 'object') return { h: entry.h, f: entry.f, b: entry.b };
    return null;
  }).filter(Boolean);
}

async function mangaExists(mdId) {
  return !!(await db.prepare('SELECT 1 FROM manga WHERE mangadex_id = ?').get(mdId));
}

/** Sync chapter metadata for ALL configured languages (en + ar by default). */
async function syncAllLangs(mangaId, mangadexId) {
  let count = 0;
  for (const lang of config.mangadex.langs) {
    count += await syncMangaChapters(mangaId, mangadexId, lang);
    await delay(100);
  }
  return count;
}

/** Fetch N pages of a MangaDex list with pacing. */
async function fetchPages(kind, pages, perPage, pace) {
  const out = [];
  for (let p = 0; p < pages; p++) {
    const list = kind === 'latest' ? await getLatest(perPage, p * perPage) : await getPopular(perPage, p * perPage);
    out.push(...list);
    if (p < pages - 1) await delay(pace);
  }
  return out;
}

/** Existing manga to refresh — ongoing/hiatus first, then oldest-synced. */
async function refreshCandidates(limit) {
  return db
    .prepare(
      `SELECT id, mangadex_id FROM manga WHERE mangadex_id IS NOT NULL
       ORDER BY CASE WHEN status IN ('ongoing','hiatus') THEN 0 ELSE 1 END,
                last_sync_at ASC NULLS FIRST LIMIT ?`
    )
    .all(Math.max(1, limit || 10));
}

/**
 * Bulk sync entry point.
 *  - 'daily'  : NEW works up to dailyLimit (default 75), all chapters each;
 *               plus refresh of known works in the pulled lists + ongoing batch.
 *  - 'ongoing': pull recently-updated list + ongoing/hiatus batch, refresh
 *               their chapter feeds (new chapters appear first-by-first).
 *  - 'popular'/'latest': deep manual pulls (new + refresh in-list).
 *  - 'full'   : 1 popular page + 1 latest page + ongoing batch.
 *  - 'refresh': refresh ongoing-priority batch of existing manga.
 */
async function runSync(mode = 'full', opts = {}) {
  if (syncStatus.running) return { started: false, message: 'Sync already running' };
  syncStatus.running = true;
  syncStatus.lastError = null;
  syncStatus.lastMode = mode;
  const cfg = config.mangadex;
  const perPage = Math.min(100, Math.max(1, opts.perPage || cfg.syncPerPage));
  const pace = Math.max(50, opts.paceMs || cfg.atHomeDelayMs);

  try {
    const seen = new Set();
    const lists = [];
    const push = (md) => {
      if (!seen.has(md.id)) {
        seen.add(md.id);
        lists.push(md);
      }
    };

    // ── collect lists ─────────────────────────────────────────────
    if (mode === 'popular' || mode === 'full') {
      for (const md of await fetchPages('popular', mode === 'full' ? 1 : cfg.syncPopularPages, perPage, pace)) push(md);
    }
    if (mode === 'latest' || mode === 'full') {
      for (const md of await fetchPages('latest', mode === 'full' ? 1 : cfg.syncLatestPages, perPage, pace)) push(md);
    }
    if (mode === 'daily') {
      for (const md of await fetchPages('popular', cfg.syncPopularPages, perPage, pace)) push(md);
      for (const md of await fetchPages('latest', cfg.syncLatestPages, perPage, pace)) push(md);
    }
    if (mode === 'ongoing') {
      for (const md of await fetchPages('latest', 1, Math.min(perPage, cfg.ongoingBatch), pace)) push(md);
    }
    if (mode === 'super') {
      // full library sweep: popular + new releases + hidden gems (top rated)
      for (const md of await fetchPages('popular', 6, perPage, pace)) push(md);
      for (const md of await fetchPages('latest', 4, perPage, pace)) push(md);
      for (let p = 0; p < 4; p++) {
        for (const md of await getTopRated(perPage, p * perPage)) push(md);
        await delay(pace);
      }
    }

    let mangaSynced = 0;
    let chaptersSynced = 0;
    let newManga = 0;
    let refreshed = 0;

    // ── progress tracking (admin progress bar) ────────────────────
    const superCap = mode === 'super' ? Math.min(500, opts.limit || 500) : Infinity;
    const newCap = mode === 'daily' ? Math.min(100, opts.limit || cfg.dailyLimit) : mode === 'super' ? superCap : lists.length;
    const inListRefresh = mode === 'super' ? 60 : mode === 'daily' ? 10 : mode === 'full' ? cfg.refreshBatch : mode === 'ongoing' ? lists.length : lists.length;
    const dbBatch = mode === 'refresh' || mode === 'ongoing' ? cfg.refreshBatch + cfg.ongoingBatch : mode === 'super' ? 20 : cfg.refreshBatch;
    syncStatus.progress = {
      total: Math.min(lists.length, newCap) + inListRefresh + dbBatch,
      done: 0,
      current: '',
    };
    const tick = (title) => {
      syncStatus.progress.done += 1;
      syncStatus.progress.current = (title || '').slice(0, 60);
    };

    // ── phase 1: NEW works with all chapters ──────────────────────
    for (const md of lists) {
      if (newManga >= newCap) break;
      if (await mangaExists(md.id)) continue;
      const localId = await upsertManga(md);
      chaptersSynced += await syncAllLangs(localId, md.id);
      newManga += 1;
      mangaSynced += 1;
      tick(md.attributes && firstTitle(md));
      await delay(pace);
    }

    // ── phase 2: refresh chapter lists of existing manga ──────────
    // (a) known works that appeared in the pulled lists (cheap, fresh)
    let listRefreshed = 0;
    for (const md of lists) {
      if (listRefreshed >= inListRefresh) break;
      if (!(await mangaExists(md.id))) continue;
      const row = await db.prepare('SELECT id FROM manga WHERE mangadex_id = ?').get(md.id);
      chaptersSynced += await syncAllLangs(row.id, md.id);
      await db.prepare('UPDATE manga SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
      listRefreshed += 1;
      refreshed += 1;
      tick(md.attributes && firstTitle(md));
      await delay(pace);
    }
    // (b) ongoing/hiatus batch from the DB (priority refresh)
    for (const m of await refreshCandidates(dbBatch)) {
      chaptersSynced += await syncAllLangs(m.id, m.mangadex_id);
      await db.prepare('UPDATE manga SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), m.id);
      refreshed += 1;
      tick(m.id);
      await delay(pace);
    }

    syncStatus.lastRun = new Date().toISOString();
    syncStatus.lastCount = mangaSynced + refreshed;
    syncStatus.progress = null;
    return {
      started: true,
      mode,
      mangaSynced,
      chaptersSynced,
      newManga,
      refreshedManga: refreshed,
      lastRun: syncStatus.lastRun,
    };
  } catch (err) {
    syncStatus.lastError = err.message;
    syncStatus.progress = null;
    throw err;
  } finally {
    syncStatus.running = false;
  }
}

async function getSyncStatus() {
  const count = async (sql) => Number((await db.prepare(sql).get()).n) || 0;
  return {
    ...syncStatus,
    activeSource: await getSetting('content_source', 'mangadex'),
    altApiBase: await getSetting('alt_api_base', ''),
    mangaCount: await count('SELECT COUNT(*) AS n FROM manga'),
    chapterCount: await count('SELECT COUNT(*) AS n FROM manga_chapters'),
    chaptersWithPages: await count(
      "SELECT COUNT(*) AS n FROM manga_chapters WHERE pages_json != '[]' AND pages_json IS NOT NULL"
    ),
    ongoingCount: await count("SELECT COUNT(*) AS n FROM manga WHERE status IN ('ongoing','hiatus')"),
  };
}

module.exports = {
  searchManga,
  getPopular,
  getLatest,
  getTopRated,
  upsertManga,
  syncMangaChapters,
  resolveChapterPages,
  normalizePages,
  runSync,
  getSyncStatus,
  mdFetch,
};
