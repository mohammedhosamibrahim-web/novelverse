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

function limitFor() {
  return getIntSetting('download_limit', config.download.dailyLimit);
}

function bonusFor() {
  return getIntSetting('reward_bonus', config.download.rewardBonus);
}

function validityHours() {
  return getIntSetting('reward_validity_hours', config.download.rewardValidityHours);
}

function tokenTtlMin() {
  return getIntSetting('reward_token_ttl_min', config.download.rewardTokenTtlMin);
}

/** Downloads recorded for a bucket in the rolling 24h window. */
function usedCount(bucket) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM downloads WHERE bucket = ? AND created_at > datetime('now', '-24 hours')")
    .get(bucket).n;
}

/** Sum of bonus from active rewards (user-scoped). */
function activeBonus(userId) {
  const row = db
    .prepare("SELECT COALESCE(SUM(bonus), 0) AS b FROM download_rewards WHERE user_id = ? AND expires_at > datetime('now')")
    .get(userId);
  return row ? row.b : 0;
}

function status(userId, ip) {
  const bucket = bucketFor(userId, ip);
  const limit = limitFor();
  const bonus = userId ? activeBonus(userId) : 0;
  const used = usedCount(bucket);
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
function recordDownload(userId, ip, chapterKey, chapterType) {
  const bucket = bucketFor(userId, ip);
  const existing = db
    .prepare('SELECT id FROM downloads WHERE bucket = ? AND chapter_key = ? AND created_at > datetime(\'now\', \'-24 hours\')')
    .get(bucket, chapterKey);
  if (existing) return status(userId, ip);

  const current = status(userId, ip);
  if (current.used >= current.limit + current.bonus) {
    throw new LimitReachedError(current);
  }
  db.prepare('INSERT INTO downloads (bucket, chapter_key, chapter_type) VALUES (?, ?, ?)').run(bucket, chapterKey, chapterType);
  return status(userId, ip);
}

/**
 * Issue a one-time grant token after the user watched the rewarded ad.
 * Requires the download_wall ad slot to be enabled (an admin must have
 * configured an ad there, otherwise there is nothing to reward).
 */
function createRewardToken(userId) {
  const slot = db.prepare('SELECT enabled FROM ad_slots WHERE slot_key = ?').get('download_wall');
  if (!slot || !slot.enabled) {
    const err = new Error('Rewarded ad slot is not configured');
    err.code = 'AD_SLOT_DISABLED';
    throw err;
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare(
    "INSERT INTO reward_tokens (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))"
  ).run(token, userId, tokenTtlMin());
  return { token, ttlMinutes: tokenTtlMin(), bonus: bonusFor() };
}

/** Redeem a grant token → +bonus downloads valid for `validity_hours`. */
function redeemReward(userId, token) {
  const row = db.prepare('SELECT * FROM reward_tokens WHERE token = ?').get(token);
  if (!row || row.user_id !== userId || row.redeemed) {
    throw new Error('Invalid or already used reward token');
  }
  if (new Date(row.expires_at + 'Z') < new Date()) {
    throw new Error('Reward token expired — watch the ad again');
  }
  db.prepare('UPDATE reward_tokens SET redeemed = 1 WHERE id = ?').run(row.id);
  const bonus = bonusFor();
  db.prepare(
    "INSERT INTO download_rewards (user_id, bonus, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' hours'))"
  ).run(userId, bonus, validityHours());
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
