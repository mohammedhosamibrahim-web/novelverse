'use strict';

/**
 * SQLite database layer.
 * Schema + seed. All queries MUST use parameterized statements.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

if (!fs.existsSync(path.dirname(config.dbPath))) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin','moderator','user')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS manga (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mangadex_id  TEXT UNIQUE,
  title        TEXT NOT NULL,
  alt_titles   TEXT NOT NULL DEFAULT '[]',
  description  TEXT NOT NULL DEFAULT '',
  cover_url    TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT '',
  year         INTEGER,
  last_sync_at TEXT
);

CREATE TABLE IF NOT EXISTS manga_chapters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  manga_id       INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  chapter_number REAL,
  title          TEXT NOT NULL DEFAULT '',
  volume         TEXT,
  lang           TEXT NOT NULL DEFAULT 'en',
  pages_json     TEXT NOT NULL DEFAULT '[]',
  external_url   TEXT,
  uploaded_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (manga_id, chapter_number, lang)
);



CREATE TABLE IF NOT EXISTS novels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_url  TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL,
  source_id  TEXT,
  toc_url    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS novel_chapters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id      INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',
  fetched_at    TEXT,
  UNIQUE (novel_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_spoiler  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS reading_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT,
  target_id   TEXT,
  chapter_id  TEXT,
  progress    REAL NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, target_type, target_id)
);

-- downloads: one row per chapter downloaded (bucket = 'u:<id>' or 'ip:<addr>')
CREATE TABLE IF NOT EXISTS downloads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket       TEXT NOT NULL,
  chapter_key  TEXT NOT NULL,
  chapter_type TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_downloads_bucket_time ON downloads (bucket, created_at);

-- rewarded-ad unlocks: each active row = +bonus downloads for the window
CREATE TABLE IF NOT EXISTS download_rewards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bonus      INTEGER NOT NULL DEFAULT 5,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- one-time grant tokens issued after an ad is watched
CREATE TABLE IF NOT EXISTS reward_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT UNIQUE NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  redeemed   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ad_slots (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_key TEXT UNIQUE NOT NULL,
  name     TEXT NOT NULL,
  html     TEXT NOT NULL DEFAULT '',
  enabled  INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'manga', -- manga | metadata | image
  enabled    INTEGER NOT NULL DEFAULT 1,
  priority   INTEGER NOT NULL DEFAULT 100,
  status     TEXT NOT NULL DEFAULT 'unknown', -- unknown | ok | slow | down | degraded
  latency_ms INTEGER NOT NULL DEFAULT 0,
  last_check TEXT
);
`);

// Migration: add MangaDex chapter id to manga_chapters (enables lazy
// at-home page resolution and self-healing image URLs).
{
  const cols = db.prepare('PRAGMA table_info(manga_chapters)').all();
  if (!cols.some((c) => c.name === 'md_chapter_id')) {
    db.exec('ALTER TABLE manga_chapters ADD COLUMN md_chapter_id TEXT');
  }
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_chapters_md_id ON manga_chapters(md_chapter_id) WHERE md_chapter_id IS NOT NULL'
  );
}

// Migration: multi-provider support (AniList metadata sync etc.)
{
  const mcols = db.prepare('PRAGMA table_info(manga)').all();
  if (!mcols.some((c) => c.name === 'provider')) db.exec("ALTER TABLE manga ADD COLUMN provider TEXT NOT NULL DEFAULT 'mangadex'");
  if (!mcols.some((c) => c.name === 'provider_id')) db.exec('ALTER TABLE manga ADD COLUMN provider_id TEXT');
  if (!mcols.some((c) => c.name === 'score')) db.exec('ALTER TABLE manga ADD COLUMN score INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_manga_provider ON manga (provider, provider_id)');
  // mirror CDN fallback pages (mangapill mirror provider)
  const ccols = db.prepare('PRAGMA table_info(manga_chapters)').all();
  if (!ccols.some((c) => c.name === 'mirror_pages_json')) {
    db.exec("ALTER TABLE manga_chapters ADD COLUMN mirror_pages_json TEXT NOT NULL DEFAULT '[]'");
  }
}

// ── Seed ────────────────────────────────────────────────────────────────

const seedSettings = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
seedSettings.run('download_limit', String(config.download.dailyLimit));
seedSettings.run('reward_bonus', String(config.download.rewardBonus));
seedSettings.run('reward_validity_hours', String(config.download.rewardValidityHours));
seedSettings.run('reward_token_ttl_min', String(config.download.rewardTokenTtlMin));
// content source switching (admin panel): 'mangadex' | 'alternative'
seedSettings.run('content_source', 'mangadex');
seedSettings.run('alt_api_base', '');
seedSettings.run('image_fallback_proxy', '');

// multi-source registry (admin panel): providers with enable/priority/health
const seedSource = db.prepare('INSERT OR IGNORE INTO sources (id, name, type, enabled, priority) VALUES (?, ?, ?, ?, ?)');
seedSource.run('mangadex', 'MangaDex', 'manga', 1, 1);
seedSource.run('mangapill', 'Mangapill (mirror CDN)', 'image', 1, 2); // working image fallback (cdn.readdetectiveconan.com)
seedSource.run('comick', 'ComicK', 'image', 0, 3); // public API closed (SPA only) — kept for when it returns
seedSource.run('anilist', 'AniList', 'metadata', 1, 4);
seedSource.run('mangaupdates', 'MangaUpdates', 'metadata', 1, 5);
seedSource.run('consumet', 'Consumet', 'manga', 0, 6); // DMCA'd (451) — kept for when a mirror returns

const defaultSlots = [
  ['header', 'Header Banner', ''],
  ['reader_top', 'In-Reader Top', ''],
  ['reader_bottom', 'In-Reader Bottom', ''],
  ['in_reader', 'Between Images/Paragraphs', ''],
  ['download_wall', 'Download Wall (Rewarded Ad)', ''],
  ['sidebar', 'Sidebar', ''],
  ['footer', 'Footer', ''],
];
const seedSlot = db.prepare('INSERT OR IGNORE INTO ad_slots (slot_key, name, html, enabled, position) VALUES (?, ?, ?, 0, ?)');
for (const [key, name] of defaultSlots) {
  seedSlot.run(key, name, '', key === 'in_reader' ? JSON.stringify({ every: 8, unit: 'images' }) : '{}');
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Read a setting with a fallback default. */
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : String(fallback);
}

/** Parse a setting as an integer. */
function getIntSetting(key, fallback) {
  return parseInt(getSetting(key, fallback), 10) || fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { db, getSetting, getIntSetting, setSetting };
