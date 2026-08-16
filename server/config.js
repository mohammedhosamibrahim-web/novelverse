'use strict';

require('dotenv').config();
const path = require('path');

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

const config = {
  isProd,
  isTest,
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || (isTest ? 'test-secret' : 'dev-secret-CHANGE-ME'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dbPath: path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db')),
  clientDist: path.join(__dirname, '..', 'client', 'dist'),

  mangadex: {
    baseUrl: 'https://api.mangadex.org',
    userAgent: process.env.MANGADEX_UA || 'WebNovelPlatform/1.0 (personal reader)',
    // Image CDN requests use a browser-like UA + Referer (per MangaDex CDN
    // requirements and explicit project spec).
    imageUserAgent:
      process.env.MANGADEX_IMAGE_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    imageReferer: 'https://mangadex.org/',
    syncEnabled: process.env.MANGADEX_SYNC !== 'false',
    // scheduled cron: default every 3 hours
    syncIntervalMs: parseInt(process.env.MANGADEX_SYNC_INTERVAL_MS || String(3 * 60 * 60 * 1000), 10),
    syncLimit: parseInt(process.env.MANGADEX_SYNC_LIMIT || '50', 10),
    // bulk sync depth (pages × perPage)
    syncPopularPages: parseInt(process.env.MANGADEX_SYNC_POPULAR_PAGES || '3', 10),
    syncLatestPages: parseInt(process.env.MANGADEX_SYNC_LATEST_PAGES || '2', 10),
    syncPerPage: parseInt(process.env.MANGADEX_SYNC_PER_PAGE || '50', 10),
    // pacing between MangaDex requests (rate-limit friendliness)
    atHomeDelayMs: parseInt(process.env.MANGADEX_AT_HOME_DELAY_MS || '150', 10),
    // how many existing manga to chapter-refresh per scheduled run
    refreshBatch: parseInt(process.env.MANGADEX_REFRESH_BATCH || '10', 10),
    // daily bulk: cap of NEW works pulled per day (50–100 per spec)
    dailyLimit: parseInt(process.env.MANGADEX_DAILY_LIMIT || '75', 10),
    dailyIntervalMs: parseInt(process.env.MANGADEX_DAILY_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10),
    // ongoing tracking: refresh recently-updated/ongoing series first-by-first
    ongoingIntervalMs: parseInt(process.env.MANGADEX_ONGOING_INTERVAL_MS || String(30 * 60 * 1000), 10),
    ongoingBatch: parseInt(process.env.MANGADEX_ONGOING_BATCH || '25', 10),
    // chapter languages to sync: Arabic + English (multi-language support)
    langs: (process.env.MANGADEX_LANGS || 'en,ar')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  // Optional image fallback proxy (e.g. a Consumet-style endpoint or your own
  // mirror). URL template with {url} placeholder. Empty = disabled. The image
  // proxy tries MangaDex direct first, then this fallback, then re-resolves.
  imageFallbackProxy: process.env.IMAGE_FALLBACK_PROXY || '',

  rateLimit: {
    apiPerMin: parseInt(process.env.RATE_LIMIT_API_PER_MIN || '60', 10),
    authPerMin: parseInt(process.env.RATE_LIMIT_AUTH_PER_MIN || '10', 10),
    imagePerMin: parseInt(process.env.RATE_LIMIT_IMAGE_PER_MIN || '120', 10),
  },

  // Download limit defaults (overridable via Admin → Settings, stored in DB)
  download: {
    dailyLimit: parseInt(process.env.DOWNLOAD_DAILY_LIMIT || '11', 10),
    rewardBonus: parseInt(process.env.REWARD_BONUS || '5', 10),
    rewardValidityHours: parseInt(process.env.REWARD_VALIDITY_HOURS || '24', 10),
    rewardTokenTtlMin: parseInt(process.env.REWARD_TOKEN_TTL_MIN || '5', 10),
  },
};

module.exports = config;
