'use strict';

/**
 * Download-limit engine unit tests (no HTTP, isolated temp DB).
 * Run via: node scripts/smoke-limiter.js
 */
process.env.NODE_ENV = 'test';
process.env.DB_PATH = '/tmp/wnp-smoke-limiter.db';
const fs = require('fs');
for (const f of ['/tmp/wnp-smoke-limiter.db', '/tmp/wnp-smoke-limiter.db-wal', '/tmp/wnp-smoke-limiter.db-shm']) {
  fs.rmSync(f, { force: true });
}

const { db, dbReady } = require('../server/db');
const limiter = require('../server/services/downloadLimiter');

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function main() {
  await dbReady;

  const info = await db
    .prepare("INSERT INTO users (username, email, password_hash, role) VALUES ('tester','t@t.com','x','user')")
    .run();
  const uid = Number(info.lastInsertRowid);
  const ip = '1.2.3.4';

  console.log('— base limit (11/day) —');
  for (let i = 1; i <= 11; i++) await limiter.recordDownload(uid, ip, `novel:${i}`, 'novel');
  let st = await limiter.status(uid, ip);
  check(st.used === 11 && st.remaining === 0 && st.requiresAd === true, 'after 11 downloads: used=11, remaining=0, requiresAd=true');

  let threw = false;
  try {
    await limiter.recordDownload(uid, ip, 'novel:12', 'novel');
  } catch (e) {
    threw = e.code === 'LIMIT_REACHED';
  }
  check(threw, '12th download blocked with LIMIT_REACHED');

  st = await limiter.recordDownload(uid, ip, 'novel:1', 'novel');
  check(st.used === 11, 're-reading same chapter does not consume extra download (dedupe)');

  console.log('— rewarded ad unlock (+5) —');
  await db.prepare("UPDATE ad_slots SET enabled = 1 WHERE slot_key = 'download_wall'").run();
  const grant = await limiter.createRewardToken(uid);
  check(!!grant.token && grant.bonus === 5, `reward token issued (bonus=${grant.bonus})`);

  let redeemErr = null;
  try {
    await limiter.redeemReward(uid, 'bogus-token');
  } catch (e) {
    redeemErr = e;
  }
  check(!!redeemErr, 'bogus token rejected');

  st = await limiter.redeemReward(uid, grant.token);
  check(st.remaining === 5 && st.bonus === 5, 'redeemed: remaining=5, bonus=5');

  for (let i = 12; i <= 16; i++) await limiter.recordDownload(uid, ip, `novel:${i}`, 'novel');
  st = await limiter.status(uid, ip);
  check(st.used === 16 && st.remaining === 0, '5 extra downloads consumed (16/16)');

  threw = false;
  try {
    await limiter.recordDownload(uid, ip, 'novel:17', 'novel');
  } catch (e) {
    threw = e.code === 'LIMIT_REACHED';
  }
  check(threw, '17th download blocked again');

  let reuseErr = null;
  try {
    await limiter.redeemReward(uid, grant.token);
  } catch (e) {
    reuseErr = e;
  }
  check(!!reuseErr, 'token cannot be reused');

  console.log('— anonymous IP bucket —');
  const anonIp = '9.9.9.9';
  for (let i = 1; i <= 11; i++) await limiter.recordDownload(null, anonIp, `manga:${i}`, 'manga');
  st = await limiter.status(null, anonIp);
  check(st.used === 11 && st.requiresAd === true, 'anonymous IP capped at 11 with no reward option');

  await db.close();
  if (failures > 0) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('\nLimiter unit tests passed.');
}

main().catch((e) => {
  console.error('Smoke-limiter crashed:', e);
  process.exit(1);
});
