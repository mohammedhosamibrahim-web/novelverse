'use strict';

/**
 * SQLite → Neon Postgres data migration (one-shot, idempotent).
 *
 * Copies every table from the local SQLite DB (data/app.db) into the
 * PostgreSQL database given by DATABASE_URL, preserving row ids and
 * resetting serial sequences afterwards. Re-runnable: inserts use
 * ON CONFLICT DO NOTHING, so already-migrated rows are skipped.
 *
 * Usage:
 *   DB_DRIVER=pg DATABASE_URL="postgresql://..." node scripts/migrate-neon.js
 *
 * Prints a per-table count comparison (sqlite vs postgres) and exits
 * non-zero if any table's postgres count is lower than sqlite's.
 */

const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

// FK-safe copy order (parents before children).
const TABLES = [
  'users',
  'manga',
  'manga_chapters',
  'novels',
  'novel_chapters',
  'comments',
  'bookmarks',
  'reading_history',
  'downloads',
  'download_rewards',
  'reward_tokens',
  'ad_slots',
  'settings',
  'sources',
];

const BATCH = 500;

async function main() {
  const sqlite = new Database(DB_PATH, { readonly: true });
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });

  const report = [];
  let failed = false;

  for (const table of TABLES) {
    const colInfo = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    const cols = colInfo.map((c) => c.name);
    const idCol = colInfo.find((c) => c.name === 'id');
    const hasSerialId = !!(idCol && /int/i.test(idCol.type));
    const srcCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const perRow = cols.length;
    let copied = 0;

    const all = sqlite.prepare(`SELECT * FROM ${table}`).all();
    for (let i = 0; i < all.length; i += BATCH) {
      const rows = all.slice(i, i + BATCH);
      const placeholders = rows
        .map((_, r) => `(${cols.map((_, c) => `$${r * perRow + c + 1}`).join(',')})`)
        .join(', ');
      const values = rows.flatMap((r) => cols.map((c) => (r[c] === undefined ? null : r[c])));
      await pool.query(
        `INSERT INTO "${table}" (${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
        values
      );
      copied += rows.length;
      if (copied % (BATCH * 10) === 0 || copied === srcCount) {
        console.log(`  ${table}: ${copied}/${srcCount} rows`);
      }
    }

    // reset the id sequence so future inserts don't collide
    if (hasSerialId) {
      await pool.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`
      );
    }

    const pgCount = (await pool.query(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n;
    const ok = pgCount >= srcCount;
    if (!ok) failed = true;
    report.push({ table, sqlite: srcCount, pg: pgCount, ok });
  }

  console.log('\n── Migration summary ─────────────────────────');
  for (const r of report) {
    console.log(`${r.table.padEnd(18)} sqlite=${String(r.sqlite).padStart(6)}  pg=${String(r.pg).padStart(6)}  ${r.ok ? 'OK' : 'MISSING ROWS'}`);
  }

  const admin = await pool.query("SELECT id, username, email, role FROM users WHERE username = 'owner'");
  if (admin.rows.length) {
    console.log('\nAdmin user present:', JSON.stringify(admin.rows[0]));
  } else {
    console.log('\nWARNING: admin user (owner) NOT found in Postgres');
    failed = true;
  }

  await pool.end();
  sqlite.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
