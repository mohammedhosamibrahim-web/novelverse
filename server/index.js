'use strict';

/**
 * WebNovel Platform — Express server.
 * Serves the /api REST API and (in production) the built React client.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { apiLimiter, authLimiter } = require('./middleware/rateLimit');
const { csrfProtect } = require('./middleware/csrf');
const { proxyImageUrl } = require('./services/imageProxy');
const imageCache = require('./services/imageCache');
const mangadex = require('./services/mangadex');

imageCache.prune(); // drop cached images older than 30 days at boot

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render/Railway proxies → real client IPs
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Global API rate limiting (per IP) — anti-scraping.
app.use('/api', apiLimiter);

// CSRF double-submit protection on all state-changing API calls.
app.use('/api', csrfProtect);

app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/manga', require('./routes/manga'));
app.use('/api/novels', require('./routes/novel'));
app.use('/api/reader', require('./routes/reader'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/user', require('./routes/user'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/anime', require('./routes/anime'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/proxy/image', require('./routes/proxy').router);

// Built client (PWA) — static + SPA fallback (never intercept /api).
const indexHtml = path.join(config.clientDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  // PWA update-critical files must not be long-cached.
  for (const f of ['sw.js', 'manifest.json']) {
    app.get(`/${f}`, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, f));
    });
  }
  app.use(express.static(config.clientDist, { maxAge: '1d', index: 'index.html' }));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(indexHtml));
} else if (!config.isTest) {
  console.log('[server] client/dist not found — run `npm run build` to serve the UI');
}

// API 404 + error handler
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Scheduled MangaDex sync (disabled in tests) — cron-style background jobs:
//  - 'full'    every MANGADEX_SYNC_INTERVAL_MS (default 3h): refresh pass
//  - 'ongoing' every MANGADEX_ONGOING_INTERVAL_MS (default 30min): pull new
//              chapters on ongoing series as they are uploaded
//  - 'daily'   every MANGADEX_DAILY_INTERVAL_MS (default 24h): bulk pull of
//              50–100 NEW works with all their chapters
if (config.mangadex.syncEnabled && !config.isTest) {
  const run = (mode) => {
    mangadex
      .runSync(mode)
      .then((r) =>
        console.log(
          `[sync:${mode}]`,
          r.started
            ? `${r.mangaSynced} manga (${r.newManga} new), ${r.chaptersSynced} chapters, ${r.refreshedManga} refreshed`
            : r.message
        )
      )
      .catch((e) => console.error(`[sync:${mode}] failed:`, e.message));
  };
  setTimeout(() => run('full'), 10 * 1000); // first pass shortly after boot
  setInterval(() => run('full'), config.mangadex.syncIntervalMs);
  setInterval(() => run('ongoing'), config.mangadex.ongoingIntervalMs);
  setInterval(() => run('daily'), config.mangadex.dailyIntervalMs);
  console.log(
    `[sync] scheduled: full every ${Math.round(config.mangadex.syncIntervalMs / 60000)}min · ` +
      `ongoing every ${Math.round(config.mangadex.ongoingIntervalMs / 60000)}min · ` +
      `daily bulk (${config.mangadex.dailyLimit} new works) every ${Math.round(config.mangadex.dailyIntervalMs / 3600000)}h`
  );
}

const server = app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port} (env=${process.env.NODE_ENV || 'development'})`);
});

module.exports = { app, server };
