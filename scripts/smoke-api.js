'use strict';

/**
 * End-to-end API smoke tests — runs the Express app in-process on a
 * dedicated port with an isolated temp DB. Invoked by scripts/smoke.sh.
 */
process.env.NODE_ENV = 'test';
process.env.DB_PATH = process.env.DB_PATH || `/tmp/wnp-smoke-api-${Date.now()}.db`;
process.env.PORT = process.env.PORT || '3199';
process.env.MANGADEX_SYNC = 'false';

const idx = require('../server/index');
const BASE = `http://localhost:${process.env.PORT}`;

let server = null;

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

let jar = {};

function absorbCookies(res) {
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const sc of setCookies) {
    const pair = sc.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
}

async function req(method, path, body, { csrf = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers['X-CSRF-Token'] = jar.csrf;
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  absorbCookies(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (res.status >= 400) console.error(`    [dbg] ${method} ${path} → ${res.status} ${text.slice(0, 200)} | jar=${JSON.stringify(jar).slice(0, 160)}`);
  return { status: res.status, json, headers: res.headers };
}

async function main() {
  await idx.ready; // async boot: DB init + listen complete
  server = idx.server;

  console.log('— CSRF bootstrap —');
  const csrf = await req('GET', '/api/auth/csrf');
  check(csrf.status === 200 && csrf.json.csrfToken && jar.csrf === csrf.json.csrfToken, 'GET /api/auth/csrf sets cookie + token');

  console.log('— first account becomes Super Admin —');
  const reg1 = await req('POST', '/api/auth/register', { username: 'admin1', email: 'admin1@test.dev', password: 'password123' });
  check(reg1.status === 201 && reg1.json.user.role === 'super_admin' && reg1.json.isFirstAccount === true, 'first registration → super_admin');

  const reg2 = await req('POST', '/api/auth/register', { username: 'user2', email: 'user2@test.dev', password: 'password123' });
  check(reg2.status === 201 && reg2.json.user.role === 'user', 'second registration → regular user');

  console.log('— login / session —');
  const login = await req('POST', '/api/auth/login', { email: 'user2@test.dev', password: 'password123' });
  check(login.status === 200 && login.json.user.username === 'user2', 'login sets session cookie');
  const me = await req('GET', '/api/auth/me');
  check(me.status === 200 && me.json.user && me.json.user.role === 'user', 'GET /api/auth/me reflects session');

  console.log('— CSRF protection —');
  const noCsrf = await req('POST', '/api/user/bookmarks', { target_type: 'manga', target_id: '1' }, { csrf: false });
  check(noCsrf.status === 403 && noCsrf.json.code === 'CSRF_FAILED', 'state-changing request without CSRF header → 403');

  console.log('— RBAC —');
  const rbac = await req('GET', '/api/admin/users');
  check(rbac.status === 403, 'regular user hitting admin route → 403');

  console.log('— comments sanitization —');
  const comment = await req('POST', '/api/comments', {
    target_type: 'manga_chapter',
    target_id: '999',
    content: '<script>alert(1)</script><img src=x onerror=alert(2)><p>hello <b>world</b></p>',
    is_spoiler: true,
  });
  const c = comment.json && comment.json.comment;
  check(
    comment.status === 201 && c && !c.content.includes('<script') && !c.content.includes('onerror') && c.is_spoiler === 1,
    'script/event-handler tags stripped, spoiler flag stored'
  );

  console.log('— download limit over HTTP (11/day + rewarded +5) —');
  const Database = require('better-sqlite3');
  const d = new Database(process.env.DB_PATH);
  const mangaId = Number(
    d.prepare("INSERT INTO manga (title, mangadex_id, last_sync_at) VALUES ('Smoke Manga', 'smoke-1', datetime('now'))").run().lastInsertRowid
  );
  const insChapter = d.prepare('INSERT INTO manga_chapters (manga_id, chapter_number, title, pages_json) VALUES (?, ?, ?, ?)');
  for (let i = 1; i <= 17; i++) {
    insChapter.run(mangaId, i, `Ch ${i}`, JSON.stringify(['https://uploads.mangadex.org/data/abc/1.jpg']));
  }
  d.prepare("UPDATE ad_slots SET enabled = 1 WHERE slot_key = 'download_wall'").run();
  d.close();

  let status11 = null;
  let okCount = 0;
  for (let i = 1; i <= 11; i++) {
    const r = await req('GET', `/api/reader/manga/${mangaId}/chapters/${i}/pages`);
    if (r.status === 200) okCount += 1;
    status11 = r.json && r.json.download;
  }
  check(okCount === 11 && status11 && status11.remaining === 0 && status11.requiresAd === true, '11 chapter fetches OK, allowance exhausted');

  const blocked = await req('GET', `/api/reader/manga/${mangaId}/chapters/12/pages`);
  check(blocked.status === 429 && blocked.json.code === 'LIMIT_REACHED' && blocked.json.requiredAd === true, '12th fetch → 429 requiredAd');

  console.log('— rewarded ad unlock via HTTP —');
  const reward = await req('POST', '/api/reader/downloads/reward', {});
  check(reward.status === 200 && reward.json.token, 'grant token issued after watching ad');
  const redeem = await req('POST', '/api/reader/downloads/redeem', { token: reward.json.token });
  check(redeem.status === 200 && redeem.json.download.remaining === 5, 'redeem → +5 downloads');

  let okExtra = 0;
  let blockedFinal = null;
  for (let i = 12; i <= 16; i++) {
    const r = await req('GET', `/api/reader/manga/${mangaId}/chapters/${i}/pages`);
    if (r.status === 200) okExtra += 1;
    else blockedFinal = r.status;
  }
  const r17 = await req('GET', `/api/reader/manga/${mangaId}/chapters/17/pages`);
  if (r17.status === 429) blockedFinal = r17.status;
  check(okExtra === 5 && blockedFinal === 429, '5 bonus chapters OK (12–16), 17th blocked again (11+5 cap)');

  console.log('— rate limit headers —');
  const rl = await req('GET', '/api/manga');
  const rlHeader = rl.headers.get('ratelimit-limit') || rl.headers.get('ratelimit-policy');
  if (!rlHeader) console.error('    [dbg] rate-limit headers:', JSON.stringify([...rl.headers.keys()]));
  check(rl.status === 200 && !!rlHeader, 'RateLimit headers present');

  console.log('— admin role management —');
  const adminLogin = await req('POST', '/api/auth/login', { email: 'admin1@test.dev', password: 'password123' });
  check(adminLogin.status === 200, 'super admin login');
  const promote = await req('PATCH', '/api/admin/users/2/role', { role: 'moderator' });
  check(promote.status === 200 && promote.json.user.role === 'moderator', 'promote user2 → moderator');
  const selfDemote = await req('PATCH', '/api/admin/users/1/role', { role: 'user' });
  check(selfDemote.status === 400, 'super admin cannot demote self');
  const demote = await req('PATCH', '/api/admin/users/2/role', { role: 'user' });
  check(demote.status === 200, 'demote user2 → user');
  const usersAfter = await req('GET', '/api/admin/users');
  const user2After = (usersAfter.json.users || []).find((u) => u.id === 2);
  check(!!user2After && user2After.role === 'user', 'role change visible in user list (DB-backed, immediate)');

  console.log('— ad management API —');
  const adminAds = await req('GET', '/api/admin/ads');
  check(adminAds.status === 200 && adminAds.json.slots.length === 7, 'admin lists all slots');
  const putAd = await req('PUT', '/api/admin/ads/header', { html: '<div class="ad-banner">TEST AD</div>', enabled: true });
  check(putAd.status === 200, 'update slot html/enabled');
  const slotKeys = ['header', 'reader_top', 'reader_bottom', 'in_reader', 'download_wall', 'sidebar', 'footer'];
  let enabledAll = true;
  for (const k of slotKeys) {
    const r = await req('PUT', `/api/admin/ads/${k}`, { enabled: true });
    if (r.status !== 200) enabledAll = false;
  }
  check(enabledAll, 'enable all 7 ad slots');
  const adsAfter = await req('GET', '/api/ads');
  const keys = (adsAfter.json.slots || []).map((s) => s.key);
  check(
    slotKeys.every((k) => keys.includes(k)) && adsAfter.json.slots.some((s) => s.key === 'header' && s.html.includes('TEST AD')),
    'all slots served publicly with updated html'
  );
  const settings = await req('GET', '/api/admin/settings');
  check(settings.status === 200 && settings.json.settings.download_limit === 11, 'settings endpoint returns download_limit');
  const putSettings = await req('PUT', '/api/admin/settings', { download_limit: 9 });
  check(putSettings.status === 200, 'update download_limit');
  const statusAfter = await req('GET', '/api/reader/downloads/status');
  check(statusAfter.json.download.limit === 9, 'new limit effective immediately');

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) FAILED`);
    server.close();
    process.exit(1);
  }
  console.log('\nAPI smoke tests passed.');
  server.close();
}

main().catch((e) => {
  console.error('Smoke run crashed:', e);
  server.close();
  process.exit(1);
});
