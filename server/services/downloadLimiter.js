'use strict';

/**
 * Dynamic daily download limit engine.
 *
 * Rules (per the spec):
 *  - Every registered user can download up to `download_limit` (default 11)
 *    chapters per rolling 24 hours.
 *  - Watching a rewarded ad issues a one-time grant token; redeeming it
 *    grants +`reward_bonus` (default 5) downloads valid for
 *    `reward_validity_hours` (default 24) hours.
 *  - Anonymous users are bucketed by IP with the same base limit (no ads).
 *
 * A "download" is a chapter content fetch (manga pages list / novel chapter
 * text). Re-reading the SAME chapter within the window is free (deduped).
 */
const crypto = require('crypto');
const { db, getIntSetting } = require('../db');
const config = require('../config');

class LimitReachedError extends Error {
  constructor(downloadStatus) {
    super('Daily download limit reached');
    this.code = 'LIMIT_REACHED';
    this.download = downloadStatus;
  }
}

function bucketFor(userId, ip) {
  return userId ? `u:${userId}` : `ip:${ip || 'unknown'}`;
}

async function limitFor() {
  return getIntSetting('download_limit', config.download.dailyLimit);
}

async function bonusFor() {
  return getIntSetting('reward_bonus', config.download.rewardBonus);
}

async function validityHours() {
  return getIntSetting('reward_validity_hours', config.download.rewardValidityHours);
}

async function tokenTtlMin() {
  return getIntSetting('reward_token_ttl_min', config.download.rewardTokenTtlMin);
}

/** Downloads recorded for a bucket in the rolling 24h window. */
async function usedCount(bucket) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM downloads WHERE bucket = ? AND created_at > datetime('now', '-24 hours')")
    .get(bucket);
  return Number(row.n) || 0; // pg returns COUNT (bigint) as string — coerce
}

/** Sum of bonus from active rewards (user-scoped). */
async function activeBonus(userId) {
  const row = await db
    .prepare("SELECT COALESCE(SUM(bonus), 0) AS b FROM download_rewards WHERE user_id = ? AND expires_at > datetime('now')")
    .get(userId);
  return row ? Number(row.b) || 0 : 0; // pg returns SUM (bigint) as string — coerce
}

async function status(userId, ip) {
  const bucket = bucketFor(userId, ip);
  const limit = await limitFor();
  const bonus = userId ? await activeBonus(userId) : 0;
  const used = await usedCount(bucket);
  const remaining = Math.max(0, limit + bonus - used);
  return {
    bucket,
    used,
    limit,
    bonus,
    remaining,
    requiresAd: used >= limit + bonus,
    authenticated: !!userId,
  };
}

/**
 * Check + record a chapter download. Throws LimitReachedError (HTTP 429)
 * when the user has exhausted their allowance. Dedupes same-chapter fetches.
 */
async function recordDownload(userId, ip, chapterKey, chapterType) {
  const bucket = bucketFor(userId, ip);
  const existing = await db
    .prepare("SELECT id FROM downloads WHERE bucket = ? AND chapter_key = ? AND created_at > datetime('now', '-24 hours')")
    .get(bucket, chapterKey);
  if (existing) return status(userId, ip);

  const current = await status(userId, ip);
  if (current.used >= current.limit + current.bonus) {
    throw new LimitReachedError(current);
  }
  await db.prepare('INSERT INTO downloads (bucket, chapter_key, chapter_type) VALUES (?, ?, ?)').run(bucket, chapterKey, chapterType);
  return status(userId, ip);
}

/**
 * Issue a one-time grant token after the user watched the rewarded ad.
 * Requires the download_wall ad slot to be enabled.
 */
async function createRewardToken(userId) {
  const slot = await db.prepare('SELECT enabled FROM ad_slots WHERE slot_key = ?').get('download_wall');
  if (!slot || !slot.enabled) {
    const err = new Error('Rewarded ad slot is not configured');
    err.code = 'AD_SLOT_DISABLED';
    throw err;
  }
  const token = crypto.randomBytes(24).toString('hex');
  await db
    .prepare("INSERT INTO reward_tokens (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))")
    .run(token, userId, await tokenTtlMin());
  return { token, ttlMinutes: await tokenTtlMin(), bonus: await bonusFor() };
}

/** Redeem a grant token → +bonus downloads valid for `validity_hours`. */
async function redeemReward(userId, token) {
  const row = await db.prepare('SELECT * FROM reward_tokens WHERE token = ?').get(token);
  if (!row || row.user_id !== userId || row.redeemed) {
    throw new Error('Invalid or already used reward token');
  }
  if (new Date(row.expires_at + (String(row.expires_at).includes('T') ? '' : 'Z')) < new Date()) {
    throw new Error('Reward token expired — watch the ad again');
  }
  await db.prepare('UPDATE reward_tokens SET redeemed = 1 WHERE id = ?').run(row.id);
  const bonus = await bonusFor();
  await db
    .prepare("INSERT INTO download_rewards (user_id, bonus, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' hours'))")
    .run(userId, bonus, await validityHours());
  return status(userId, null);
}

module.exports = {
  LimitReachedError,
  status,
  recordDownload,
  createRewardToken,
  redeemReward,
  usedCount,
  activeBonus,
};
