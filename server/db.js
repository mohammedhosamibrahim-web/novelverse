'use strict';

/**
 * Database layer — dual driver.
 *  - SQLite (better-sqlite3): default + tests (sync wrapped to async API).
 *  - PostgreSQL (pg): set DB_DRIVER=pg + DATABASE_URL (used on Vercel).
 *
 * All callers use the SAME async API: `await db.prepare(sql).get/all/run(...)`.
 * SQLite-style SQL (`?`, `datetime('now')`, `INSERT OR IGNORE`) is converted
 * to PostgreSQL on the pg driver. All queries MUST use parameterized statements.
 */
const config = require('./config');
const isPg = config.dbDriver === 'pg';

let sqlite = null;
let pool = null;
let pgInit = null;

const SQLITE_SCHEMA = `
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
  last_sync_at TEXT,
  provider     TEXT NOT NULL DEFAULT 'mangadex',
  provider_id  TEXT,
  score        INTEGER
);

CREATE TABLE IF NOT EXISTS manga_chapters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  manga_id         INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  chapter_number   REAL,
  title            TEXT NOT NULL DEFAULT '',
  volume           TEXT,
  lang             TEXT NOT NULL DEFAULT 'en',
  pages_json       TEXT NOT NULL DEFAULT '[]',
  external_url     TEXT,
  uploaded_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  md_chapter_id    TEXT,
  mirror_pages_json TEXT NOT NULL DEFAULT '[]',
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

CREATE TABLE IF NOT EXISTS downloads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket       TEXT NOT NULL,
  chapter_key  TEXT NOT NULL,
  chapter_type TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_downloads_bucket_time ON downloads (bucket, created_at);

CREATE TABLE IF NOT EXISTS download_rewards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bonus      INTEGER NOT NULL DEFAULT 5,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

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
  type       TEXT NOT NULL DEFAULT 'manga',
  enabled    INTEGER NOT NULL DEFAULT 1,
  priority   INTEGER NOT NULL DEFAULT 100,
  status     TEXT NOT NULL DEFAULT 'unknown',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  last_check TEXT
);
`;

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin','moderator','user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS manga (
  id           SERIAL PRIMARY KEY,
  mangadex_id  TEXT UNIQUE,
  title        TEXT NOT NULL,
  alt_titles   TEXT NOT NULL DEFAULT '[]',
  description  TEXT NOT NULL DEFAULT '',
  cover_url    TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT '',
  year         INTEGER,
  last_sync_at TEXT,
  provider     TEXT NOT NULL DEFAULT 'mangadex',
  provider_id  TEXT,
  score        INTEGER
);
CREATE TABLE IF NOT EXISTS manga_chapters (
  id               SERIAL PRIMARY KEY,
  manga_id         INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  chapter_number   DOUBLE PRECISION,
  title            TEXT NOT NULL DEFAULT '',
  volume           TEXT,
  lang             TEXT NOT NULL DEFAULT 'en',
  pages_json       TEXT NOT NULL DEFAULT '[]',
  external_url     TEXT,
  uploaded_at      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  md_chapter_id    TEXT,
  mirror_pages_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (manga_id, chapter_number, lang)
);
CREATE TABLE IF NOT EXISTS novels (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_url  TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL,
  source_id  TEXT,
  toc_url    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS novel_chapters (
  id            SERIAL PRIMARY KEY,
  novel_id      INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',
  fetched_at    TEXT,
  UNIQUE (novel_id, chapter_index)
);
CREATE TABLE IF NOT EXISTS comments (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  content     TEXT NOT NULL,
  is_spoiler  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id);
CREATE TABLE IF NOT EXISTS bookmarks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS reading_history (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT,
  target_id   TEXT,
  chapter_id  TEXT,
  progress    DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS downloads (
  id           SERIAL PRIMARY KEY,
  bucket       TEXT NOT NULL,
  chapter_key  TEXT NOT NULL,
  chapter_type TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_downloads_bucket_time ON downloads (bucket, created_at);
CREATE TABLE IF NOT EXISTS download_rewards (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bonus      INTEGER NOT NULL DEFAULT 5,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_tokens (
  id         SERIAL PRIMARY KEY,
  token      TEXT UNIQUE NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ad_slots (
  id       SERIAL PRIMARY KEY,
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
  type       TEXT NOT NULL DEFAULT 'manga',
  enabled    INTEGER NOT NULL DEFAULT 1,
  priority   INTEGER NOT NULL DEFAULT 100,
  status     TEXT NOT NULL DEFAULT 'unknown',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  last_check TEXT
);
`;

const ID_TABLES = new Set([
  'users', 'manga', 'manga_chapters', 'novels', 'novel_chapters', 'comments',
  'bookmarks', 'reading_history', 'downloads', 'download_rewards', 'reward_tokens', 'ad_slots', 'sources',
]);

/** Convert SQLite-flavored SQL to PostgreSQL. */
function toPgSql(sql) {
  const hadOrIgnore = /INSERT OR IGNORE INTO/i.test(sql);
  let i = 0;
  let s = sql
    .replace(/INSERT OR IGNORE INTO/g, 'INSERT INTO')
    .replace(/datetime\('now'\)/g, 'now()')
    .replace(/datetime\('now', '([^']*)'\)/g, (m, mod) => `now() + interval '${mod}'`)
    .replace(/datetime\('now',\s*('[^']*' \|\| \? \|\| '[^']*')\)/g, (m, expr) => `now() + (${expr})::interval`)
    .replace(/\?/g, () => `$${++i}`);
  if (hadOrIgnore && !/ON CONFLICT/i.test(s)) s += ' ON CONFLICT DO NOTHING';
  return s;
}

function fmtValue(v) {
  if (v instanceof Date) {
    return v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  }
  return v;
}

let db;

if (isPg) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  db = {
    prepare(sql) {
      const pgSql = toPgSql(sql);
      const m = /^\s*INSERT INTO\s+(\w+)/i.exec(pgSql);
      const wantId = m && ID_TABLES.has(m[1]) && !/RETURNING/i.test(pgSql);
      const final = wantId ? `${pgSql} RETURNING id` : pgSql;
      const hasReturning = /RETURNING/i.test(final);
      return {
        async get(...params) {
          const r = await pool.query(final, params);
          const row = r.rows[0];
          if (!row) return undefined;
          const out = {};
          for (const [k, v] of Object.entries(row)) out[k] = fmtValue(v);
          return out;
        },
        async all(...params) {
          const r = await pool.query(final, params);
          return r.rows.map((row) => {
            const out = {};
            for (const [k, v] of Object.entries(row)) out[k] = fmtValue(v);
            return out;
          });
        },
        async run(...params) {
          const r = await pool.query(final, params);
          return {
            changes: r.rowCount,
            lastInsertRowid: hasReturning && r.rows[0] ? r.rows[0].id : undefined,
          };
        },
      };
    },
    async exec(sql) {
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        await pool.query(stmt);
      }
    },
    transaction(fn) {
      return fn(); // pg auto-commits per statement
    },
    close() {
      return pool.end();
    },
  };

  pgInit = (async () => {
    await db.exec(PG_SCHEMA);
    // migrations (idempotent)
    await pool.query('ALTER TABLE manga_chapters ADD COLUMN IF NOT EXISTS md_chapter_id TEXT');
    await pool.query('ALTER TABLE manga ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT \'mangadex\'');
    await pool.query('ALTER TABLE manga ADD COLUMN IF NOT EXISTS provider_id TEXT');
    await pool.query('ALTER TABLE manga ADD COLUMN IF NOT EXISTS score INTEGER');
    await pool.query('ALTER TABLE manga_chapters ADD COLUMN IF NOT EXISTS mirror_pages_json TEXT NOT NULL DEFAULT \'[]\'');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_manga_provider ON manga (provider, provider_id)');
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_chapters_md_id ON manga_chapters(md_chapter_id) WHERE md_chapter_id IS NOT NULL'
    );
  })();
} else {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  if (!fs.existsSync(path.dirname(config.dbPath))) {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  }
  sqlite = new Database(config.dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SQLITE_SCHEMA);

  // migrations
  {
    const cols = sqlite.prepare('PRAGMA table_info(manga_chapters)').all();
    if (!cols.some((c) => c.name === 'md_chapter_id')) sqlite.exec('ALTER TABLE manga_chapters ADD COLUMN md_chapter_id TEXT');
    if (!cols.some((c) => c.name === 'mirror_pages_json')) sqlite.exec("ALTER TABLE manga_chapters ADD COLUMN mirror_pages_json TEXT NOT NULL DEFAULT '[]'");
    const mcols = sqlite.prepare('PRAGMA table_info(manga)').all();
    if (!mcols.some((c) => c.name === 'provider')) sqlite.exec("ALTER TABLE manga ADD COLUMN provider TEXT NOT NULL DEFAULT 'mangadex'");
    if (!mcols.some((c) => c.name === 'provider_id')) sqlite.exec('ALTER TABLE manga ADD COLUMN provider_id TEXT');
    if (!mcols.some((c) => c.name === 'score')) sqlite.exec('ALTER TABLE manga ADD COLUMN score INTEGER');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_manga_provider ON manga (provider, provider_id)');
    sqlite.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_chapters_md_id ON manga_chapters(md_chapter_id) WHERE md_chapter_id IS NOT NULL'
    );
  }

  db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        get: async (...p) => stmt.get(...p),
        all: async (...p) => stmt.all(...p),
        run: async (...p) => stmt.run(...p),
      };
    },
    exec: async (sql) => sqlite.exec(sql),
    transaction(fn) {
      return sqlite.transaction(fn)();
    },
    close() {
      sqlite.close();
    },
  };
}

// ── Seed (both drivers) ───────────────────────────────────────────────────

async function seed() {
  const seedSettings = await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  await seedSettings.run('download_limit', String(config.download.dailyLimit));
  await seedSettings.run('reward_bonus', String(config.download.rewardBonus));
  await seedSettings.run('reward_validity_hours', String(config.download.rewardValidityHours));
  await seedSettings.run('reward_token_ttl_min', String(config.download.rewardTokenTtlMin));
  await seedSettings.run('content_source', 'mangadex');
  await seedSettings.run('alt_api_base', '');
  await seedSettings.run('image_fallback_proxy', '');

  const seedSlot = await db.prepare(
    'INSERT OR IGNORE INTO ad_slots (slot_key, name, html, enabled, position) VALUES (?, ?, ?, 0, ?)'
  );
  for (const [key, name] of [
    ['header', 'Header Banner'],
    ['reader_top', 'In-Reader Top'],
    ['reader_bottom', 'In-Reader Bottom'],
    ['in_reader', 'Between Images/Paragraphs'],
    ['download_wall', 'Download Wall (Rewarded Ad)'],
    ['sidebar', 'Sidebar'],
    ['footer', 'Footer'],
  ]) {
    await seedSlot.run(key, name, '', key === 'in_reader' ? JSON.stringify({ every: 8, unit: 'images' }) : '{}');
  }

  const seedSource = await db.prepare('INSERT OR IGNORE INTO sources (id, name, type, enabled, priority) VALUES (?, ?, ?, ?, ?)');
  await seedSource.run('mangadex', 'MangaDex', 'manga', 1, 1);
  await seedSource.run('mangapill', 'Mangapill (mirror CDN)', 'image', 1, 2);
  await seedSource.run('comick', 'ComicK', 'image', 0, 3);
  await seedSource.run('anilist', 'AniList', 'metadata', 1, 4);
  await seedSource.run('mangaupdates', 'MangaUpdates', 'metadata', 1, 5);
  await seedSource.run('consumet', 'Consumet', 'manga', 0, 6);

  // mirror providers from config
  try {
    const path = require('path');
    const fs = require('fs');
    const file = path.join(__dirname, 'config', 'mirror-sources.json');
    const mirrorProviders = JSON.parse(fs.readFileSync(file, 'utf8')).providers || [];
    for (const p of mirrorProviders) {
      await seedSource.run(`mirror:${p.id}`, p.name, 'image', p.enabled ? 1 : 0, 10);
    }
  } catch {
    /* mirror config optional */
  }
}

/**
 * dbReady — resolves once schema + migrations + seed are complete.
 * index.js awaits it before accepting requests; the Vercel handler is
 * exported only after readiness too (requests queued by the platform).
 */
const dbReady = (isPg ? pgInit : Promise.resolve())
  .then(() => seed())
  .catch((e) => {
    console.error('[db] init/seed failed:', e.message);
    if (isPg) process.exit(1);
    throw e;
  });

// ── Helpers ──────────────────────────────────────────────────────────────

async function getSetting(key, fallback) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : String(fallback);
}

async function getIntSetting(key, fallback) {
  const v = await getSetting(key, fallback);
  return parseInt(v, 10) || fallback;
}

async function setSetting(key, value) {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

module.exports = { db, dbReady, getSetting, getIntSetting, setSetting, isPg, toPgSql };
