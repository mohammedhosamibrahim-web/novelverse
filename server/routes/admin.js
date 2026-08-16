'use strict';

/**
 * Super Admin dashboard API — user role management, ad management panel,
 * sync controls, site settings. Everything here requires super_admin.
 */
const express = require('express');
const { db, setSetting, getSetting, getIntSetting } = require('../db');
const { requireAuth, isSuperAdmin, ROLES } = require('../middleware/auth');
const { cleanText } = require('../middleware/sanitize');
const mangadex = require('../services/mangadex');
const mirrorManga = require('../services/mirrorManga');
const { listSources, importNovel } = require('../services/novelSync');
const providerSources = require('../services/sources');
const providerSync = require('../services/providerSync');
const config = require('../config');

const router = express.Router();
router.use(requireAuth, isSuperAdmin);

// ── Users / roles ────────────────────────────────────────────────────────

/** GET /api/admin/users */
router.get('/users', async (req, res, next) => {
  try {
    const q = cleanText(req.query.q, 100);
    const where = q ? 'WHERE username LIKE ? OR email LIKE ?' : '';
    const params = q ? [`%${q}%`, `%${q}%`] : [];
    const users = await db
      .prepare(`SELECT id, username, email, role, created_at FROM users ${where} ORDER BY id ASC LIMIT 500`)
      .all(...params);
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/users/:id/role { role: 'moderator' | 'user' }
 * Super Admin promotes/demotes users. Self-demotion is blocked (would
 * lock the site out of admin access); other super admins cannot be touched.
 */
router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const role = cleanText(req.body.role, 20);
    if (!ROLES.slice(1).includes(role)) {
      return res.status(400).json({ error: 'Role must be moderator or user' });
    }
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });
    if (target.role === 'super_admin') return res.status(400).json({ error: 'Super Admin accounts cannot be demoted' });
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
    res.json({ ok: true, user: { id: target.id, username: target.username, role } });
  } catch (err) {
    next(err);
  }
});

// ── Ad management panel ──────────────────────────────────────────────────

/** GET /api/admin/ads */
router.get('/ads', async (req, res, next) => {
  try {
    const slots = (await db.prepare('SELECT * FROM ad_slots ORDER BY id').all()).map((s) => {
      let position = {};
      try {
        position = JSON.parse(s.position || '{}');
      } catch {
        /* empty */
      }
      return { ...s, position };
    });
    res.json({ slots });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/admin/ads/:key — update html / enabled / position. */
router.put('/ads/:key', async (req, res, next) => {
  try {
    const slot = await db.prepare('SELECT * FROM ad_slots WHERE slot_key = ?').get(req.params.key);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    const html = String(req.body.html ?? slot.html);
    const enabled = req.body.enabled === undefined ? slot.enabled : (req.body.enabled ? 1 : 0);
    let position = slot.position;
    if (req.body.position) {
      try {
        position = JSON.stringify(req.body.position);
      } catch {
        return res.status(400).json({ error: 'Invalid position config' });
      }
    }
    await db.prepare('UPDATE ad_slots SET html = ?, enabled = ?, position = ? WHERE slot_key = ?').run(
      html,
      enabled,
      position,
      slot.slot_key
    );
    const updated = await db.prepare('SELECT * FROM ad_slots WHERE slot_key = ?').get(slot.slot_key);
    res.json({ ok: true, slot: updated });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/ads — create a custom slot. */
router.post('/ads', async (req, res, next) => {
  try {
    const key = cleanText(req.body.slot_key, 40);
    const name = cleanText(req.body.name, 80);
    if (!/^[a-z0-9_]+$/.test(key)) return res.status(400).json({ error: 'slot_key must be [a-z0-9_]' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    const html = String(req.body.html || '');
    await db.prepare('INSERT OR IGNORE INTO ad_slots (slot_key, name, html, enabled) VALUES (?, ?, ?, 0)').run(key, name, html);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/ads/:key */
router.delete('/ads/:key', async (req, res, next) => {
  try {
    await db.prepare('DELETE FROM ad_slots WHERE slot_key = ?').run(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Settings ─────────────────────────────────────────────────────────────

/** GET /api/admin/settings */
router.get('/settings', async (req, res, next) => {
  try {
    const [downloadLimit, rewardBonus, rewardValidity, rewardTtl, contentSource, altApiBase, fallbackProxy] =
      await Promise.all([
        getIntSetting('download_limit', config.download.dailyLimit),
        getIntSetting('reward_bonus', config.download.rewardBonus),
        getIntSetting('reward_validity_hours', config.download.rewardValidityHours),
        getIntSetting('reward_token_ttl_min', config.download.rewardTokenTtlMin),
        getSetting('content_source', 'mangadex'),
        getSetting('alt_api_base', ''),
        getSetting('image_fallback_proxy', ''),
      ]);
    res.json({
      settings: {
        download_limit: downloadLimit,
        reward_bonus: rewardBonus,
        reward_validity_hours: rewardValidity,
        reward_token_ttl_min: rewardTtl,
        content_source: contentSource,
        alt_api_base: altApiBase,
        image_fallback_proxy: fallbackProxy,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/admin/settings */
router.put('/settings', async (req, res, next) => {
  try {
    const body = req.body || {};
    const allowed = {
      download_limit: ['download_limit'],
      reward_bonus: ['reward_bonus'],
      reward_validity_hours: ['reward_validity_hours'],
      reward_token_ttl_min: ['reward_token_ttl_min'],
    };
    for (const [key, targets] of Object.entries(allowed)) {
      if (body[key] !== undefined) {
        const n = parseInt(body[key], 10);
        if (!Number.isFinite(n) || n < 1 || n > 1000) {
          return res.status(400).json({ error: `${key} must be a number between 1 and 1000` });
        }
        for (const t of targets) await setSetting(t, String(n));
      }
    }
    // content source switch + alternative endpoints
    if (body.content_source !== undefined) {
      const src = cleanText(body.content_source, 20);
      if (!['mangadex', 'alternative'].includes(src)) {
        return res.status(400).json({ error: 'content_source must be mangadex or alternative' });
      }
      await setSetting('content_source', src);
    }
    if (body.alt_api_base !== undefined) {
      const url = cleanText(body.alt_api_base, 300);
      if (url && !/^https?:\/\//.test(url)) {
        return res.status(400).json({ error: 'alt_api_base must be an http(s) URL' });
      }
      await setSetting('alt_api_base', url);
    }
    if (body.image_fallback_proxy !== undefined) {
      const url = cleanText(body.image_fallback_proxy, 500);
      if (url && !url.includes('{url}')) {
        return res.status(400).json({ error: 'image_fallback_proxy must contain the {url} placeholder' });
      }
      await setSetting('image_fallback_proxy', url);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Sync controls ────────────────────────────────────────────────────────

/**
 * POST /api/admin/sync — trigger a sync in the BACKGROUND (fire-and-forget)
 * so long 'super' sweeps never block the request. Progress is polled from
 * GET /api/admin/sync/status. Modes: super|daily|ongoing|popular|latest|refresh|full
 * plus secondary-provider modes: anilist (metadata sync).
 */
router.post('/sync', (req, res) => {
  const mode = ['super', 'daily', 'ongoing', 'popular', 'latest', 'refresh', 'full', 'anilist'].includes(req.body.mode)
    ? req.body.mode
    : 'popular';

  if (mode === 'anilist') {
    providerSync
      .syncAniListManga(parseInt(req.body.limit, 10) || 100)
      .then((r) => console.log('[admin-sync:anilist]', `${r.imported} imported, ${r.enriched} enriched, ${r.total} fetched`))
      .catch((e) => console.error('[admin-sync:anilist] failed:', e.message));
    res.json({ started: true, mode });
    return;
  }

  mangadex
    .runSync(mode, { perPage: req.body.perPage, limit: req.body.limit })
    .then((r) => console.log(`[admin-sync:${mode}]`, r.started ? `${r.newManga} new, ${r.chaptersSynced} chapters, ${r.refreshedManga} refreshed` : r.message))
    .catch((e) => console.error(`[admin-sync:${mode}] failed:`, e.message));
  res.json({ started: true, mode });
});

/** GET /api/admin/sync/status */
router.get('/sync/status', async (req, res, next) => {
  try {
    res.json(await mangadex.getSyncStatus());
  } catch (err) {
    next(err);
  }
});

// ── API sources management (multi-source fallback) ──────────────────────

/** GET /api/admin/sources — registry with health status. */
router.get('/sources', async (req, res, next) => {
  try {
    res.json({ sources: await providerSources.listSources() });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/sources/:id — enable/disable or set priority. */
router.patch('/sources/:id', async (req, res, next) => {
  try {
    const updated = await providerSources.setSource(req.params.id, {
      enabled: req.body.enabled,
      priority: req.body.priority,
    });
    if (!updated) return res.status(404).json({ error: 'Source not found' });
    res.json({ ok: true, source: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/sources/check — run live health checks for all sources. */
router.post('/sources/check', async (req, res) => {
  try {
    const sources = await providerSources.checkAll();
    res.json({ sources });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** POST /api/admin/sync-all — unified sweep across all enabled sources. */
router.post('/sync-all', async (req, res, next) => {
  try {
    mangadex
      .runSync('super', { perPage: req.body.perPage, limit: req.body.limit })
      .then((r) => console.log('[sync-all]', r.started ? `${r.newManga} new, ${r.chaptersSynced} chapters, ${r.refreshedManga} refreshed` : r.message))
      .catch((e) => console.error('[sync-all] failed:', e.message));
    const enabled = (await providerSources.listSources()).filter((s) => s.enabled).map((s) => s.id);
    res.json({ started: true, sources: enabled });
  } catch (err) {
    next(err);
  }
});

// ── Mirror image fetch (pull chapter images from external providers) ─────

const mirrorState = { running: false, total: 0, done: 0, ok: 0, failed: 0, current: '' };

/** POST /api/admin/mirror-fetch { mangaId } — warm mirror images for ALL chapters of a manga. */
router.post('/mirror-fetch', async (req, res, next) => {
  try {
    const mangaId = parseInt(req.body.mangaId, 10);
    if (!Number.isFinite(mangaId)) return res.status(400).json({ error: 'mangaId is required' });
    if (mirrorState.running) return res.json({ started: false, message: 'Already running' });
    const chapters = await db.prepare('SELECT id, chapter_number FROM manga_chapters WHERE manga_id = ?').all(mangaId);
    if (!chapters.length) return res.status(404).json({ error: 'Manga not found or has no chapters' });
    mirrorState.running = true;
    mirrorState.total = chapters.length;
    mirrorState.done = 0;
    mirrorState.ok = 0;
    mirrorState.failed = 0;
    mirrorState.current = '';
    (async () => {
      for (const ch of chapters) {
        try {
          const pages = await mirrorManga.getChapterImages(ch.id);
          if (pages && pages.length) mirrorState.ok += 1;
          else mirrorState.failed += 1;
        } catch {
          mirrorState.failed += 1;
        }
        mirrorState.done += 1;
        mirrorState.current = `Ch. ${ch.chapter_number}`;
      }
      mirrorState.running = false;
      console.log(`[mirror-fetch] manga ${mangaId}: ${mirrorState.ok} chapters with images, ${mirrorState.failed} failed`);
    })();
    res.json({ started: true, total: chapters.length });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/mirror-fetch/status */
router.get('/mirror-fetch/status', (req, res) => {
  res.json(mirrorState);
});

// ── Novel import ─────────────────────────────────────────────────────────

/** GET /api/admin/novels/sources */
router.get('/novels/sources', async (req, res, next) => {
  try {
    res.json({ sources: await listSources() });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/novels/import { sourceId, tocUrl, title?, coverUrl?, author? } */
router.post('/novels/import', async (req, res, next) => {
  try {
    const sourceId = cleanText(req.body.sourceId, 50);
    const tocUrl = cleanText(req.body.tocUrl, 500);
    if (!sourceId || !tocUrl) return res.status(400).json({ error: 'sourceId and tocUrl are required' });
    const result = await importNovel(sourceId, {
      tocUrl,
      title: cleanText(req.body.title, 200) || undefined,
      coverUrl: cleanText(req.body.coverUrl, 500) || undefined,
      author: cleanText(req.body.author, 100) || undefined,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'SOURCE_UNAVAILABLE') return res.status(404).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
