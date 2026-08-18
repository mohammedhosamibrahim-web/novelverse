'use strict';

/**
 * Reader endpoints — every chapter content fetch is a counted "download"
 * (the daily limit engine + rewarded ad wall live here).
 *
 * Image serving (broken-chapter fix):
 *  - pages_json stores either legacy absolute URLs or [{h,f,b}] entries.
 *  - If a chapter has no pages yet but has a MangaDex chapter id, pages are
 *    resolved lazily on first read (at-home server).
 *  - The image route tries dataSaver → full-quality, and re-resolves the
 *    at-home base URL on failure (self-healing when MangaDex rotates hosts).
 */
const express = require('express');
const archiver = require('archiver');
const { db, getSetting } = require('../db');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { imageLimiter } = require('../middleware/rateLimit');
const downloadLimiter = require('../services/downloadLimiter');
const mangadex = require('../services/mangadex');
const mirrorManga = require('../services/mirrorManga');
const imageCache = require('../services/imageCache');
const { getNovelChapterContent } = require('../services/novelSync');
const config = require('../config');

const router = express.Router();

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function sendLimitReached(res, err) {
  return res.status(429).json({
    error: err.message,
    code: err.code,
    requiredAd: true,
    download: err.download,
  });
}

/**
 * Build the chapter reading payload:
 *  - lazily resolves image pages via MangaDex /at-home/server/:id when needed
 *  - returns opaque page routes for rendering
 *  - includes `atHome` (baseUrl + hash + FULL page filenames) so the frontend
 *    has the complete resolved page list, as requested
 *  - counts one download per distinct chapter per 24h window
 */
async function chapterPayload(chapter, userId, ip) {
  let pages = mangadex.normalizePages(chapter.pages_json);

  // Lazy resolution: metadata exists but images were never fetched.
  if (pages.length === 0 && chapter.md_chapter_id) {
    const resolved = await mangadex.resolveChapterPages(chapter.id);
    if (resolved && resolved.length > 0) {
      pages = resolved.map((p) => ({ h: p.h, f: p.f, b: p.b }));
    }
  }

  if (pages.length === 0 && !chapter.external_url) {
    return { error: 'noPages' };
  }

  const download = await downloadLimiter.recordDownload(userId, ip, `manga:${chapter.id}`, 'manga');
  const pageUrls = pages.map((_, index) => ({ index, url: `/api/reader/image/${chapter.id}/${index}` }));

  // at-home details: base URL, hash and the full list of page filenames.
  const first = pages[0];
  const atHome =
    first && first.h
      ? { baseUrl: first.b, hash: first.h, pages: pages.map((p) => p.f), count: pages.length }
      : null;

  return {
    chapter: { id: chapter.id, number: chapter.chapter_number, title: chapter.title },
    pages: pageUrls,
    atHome,
    download,
    externalUrl: chapter.external_url || null,
  };
}

/**
 * GET /api/reader/manga/:mangaId/chapters/:chapterId/pages
 */
router.get('/manga/:mangaId/chapters/:chapterId/pages', optionalAuth, async (req, res, next) => {
  try {
    const chapter = await db
      .prepare('SELECT * FROM manga_chapters WHERE id = ? AND manga_id = ?')
      .get(req.params.chapterId, req.params.mangaId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    const payload = await chapterPayload(chapter, req.user ? req.user.id : null, clientIp(req));
    if (payload.error === 'noPages') {
      return res.status(404).json({ error: 'This chapter has no readable pages yet — try again in a moment' });
    }
    res.json(payload);
  } catch (err) {
    if (err.code === 'LIMIT_REACHED') return sendLimitReached(res, err);
    next(err);
  }
});

/**
 * GET /api/chapter/:id — direct chapter access.
 * Requests MangaDex /at-home/server/:id (hash + full page filenames) when
 * needed and returns them to the frontend along with opaque page routes.
 */
router.get('/chapter/:chapterId', optionalAuth, async (req, res, next) => {
  try {
    const chapter = await db.prepare('SELECT * FROM manga_chapters WHERE id = ?').get(req.params.chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    const payload = await chapterPayload(chapter, req.user ? req.user.id : null, clientIp(req));
    if (payload.error === 'noPages') {
      return res.status(404).json({ error: 'This chapter has no readable pages yet — try again in a moment' });
    }
    res.json(payload);
  } catch (err) {
    if (err.code === 'LIMIT_REACHED') return sendLimitReached(res, err);
    next(err);
  }
});

/**
 * GET /api/reader/novels/:novelId/chapters/:index
 * Returns sanitized chapter content (cached after first fetch).
 * Counts one download per distinct chapter per 24h window.
 */
router.get('/novels/:novelId/chapters/:index', optionalAuth, async (req, res, next) => {
  try {
    const chapter = db
      .prepare('SELECT * FROM novel_chapters WHERE novel_id = ? AND chapter_index = ?')
      .get(req.params.novelId, parseInt(req.params.index, 10));
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    const userId = req.user ? req.user.id : null;
    const download = await downloadLimiter.recordDownload(userId, clientIp(req), `novel:${chapter.id}`, 'novel');

    let content = chapter.content;
    if (!chapter.fetched_at) {
      content = await getNovelChapterContent(chapter.id, chapter.url);
    }
    res.json({ chapter: { id: chapter.id, index: chapter.chapter_index, title: chapter.title }, content, download });
  } catch (err) {
    if (err.code === 'LIMIT_REACHED') return sendLimitReached(res, err);
    if (err.code === 'SOURCE_UNAVAILABLE') return res.status(404).json({ error: err.message });
    next(err);
  }
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /api/reader/chapters/:chapterId/download
 * Server-side chapter download: all page images are fetched (through the
 * cache/proxy pipeline) and bundled into a ZIP streamed to the client.
 * Wired to the daily download limit: 11 chapters/day + 5 via rewarded ad
 * (same counter as reading — re-downloading a chapter within 24h is free).
 * Requires login (registered users only).
 */
router.get('/chapters/:chapterId/download', requireAuth, async (req, res, next) => {
  try {
    const chapter = await db.prepare('SELECT * FROM manga_chapters WHERE id = ?').get(req.params.chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    let pages = mangadex.normalizePages(chapter.pages_json);
    if (pages.length === 0 && chapter.md_chapter_id) {
      const resolved = await mangadex.resolveChapterPages(chapter.id);
      if (resolved && resolved.length > 0) pages = resolved;
    }
    if (pages.length === 0) {
      return res.status(404).json({ error: 'This chapter has no readable pages yet' });
    }

    // daily limit (11/day + rewarded +5) — throws LimitReachedError on 429
    const download = await downloadLimiter.recordDownload(req.user.id, clientIp(req), `manga:${chapter.id}`, 'manga');

    // collect page images (quick mode: fail fast when CDN rate-limits us).
    // Mirror pages are resolved ONCE up-front (cached in the DB), then all
    // page fetches run in parallel batches (bounded by the global gate).
    const pad = (n) => String(n + 1).padStart(3, '0');
    const mirrorSrc = await db.prepare("SELECT enabled FROM sources WHERE id = 'mangapill'").get();
    let mirrorPages = null;
    if (mirrorSrc && mirrorSrc.enabled) {
      try {
        mirrorPages = await mirrorManga.getChapterImages(chapter.id);
      } catch {
        mirrorPages = null;
      }
    }
    const fetchPage = async (i) => {
      const entry = pages[i];
      const candidates = entry.u
        ? [entry.u]
        : entry.h && entry.f && entry.b
          ? [`${entry.b}/dataSaver/${entry.h}/${entry.f}`, `${entry.b}/data/${entry.h}/${entry.f}`]
          : [];
      let img = null;
      for (const url of candidates) {
        img = await fetchUpstream(url, true);
        if (img) break;
      }
      // mirror CDN fallback for the page
      if (!img && mirrorPages) {
        const mirrorUrl = mirrorPages[i];
        if (mirrorUrl) {
          try {
            const cacheKey = `mirror:${chapter.id}:${i}`;
            const cached = imageCache.get(cacheKey);
            img = cached ? { buf: cached, type: 'image/jpeg' } : await mirrorManga.fetchMirrorImage(mirrorUrl);
            if (img && img.buf) imageCache.set(cacheKey, img.buf);
          } catch {
            /* skip */
          }
        }
      }
      return img;
    };
    const results = new Array(pages.length).fill(null);
    let nextIdx = 0;
    async function worker() {
      while (nextIdx < pages.length) {
        const i = nextIdx++;
        results[i] = await fetchPage(i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, pages.length) }, () => worker()));
    const entries = [];
    let failed = 0;
    for (let i = 0; i < results.length; i++) {
      const img = results[i];
      if (img) {
        const ext = (img.type || '').includes('png') ? 'png' : 'jpg';
        entries.push({ name: `page-${pad(i)}.${ext}`, buf: img.buf });
      } else {
        failed += 1;
      }
    }

    if (entries.length === 0) {
      return res.status(502).json({ error: 'No page images could be fetched — try again later' });
    }

    // build ZIP in memory and stream it down
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks = [];
    const done = new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    archive.on('data', (c) => chunks.push(c));
    for (const e of entries) archive.append(e.buf, { name: e.name });
    await archive.finalize();
    await done;

    const buf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="chapter-${chapter.chapter_number || chapter.id}.zip"`);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
    console.log(`[zip] chapter ${chapter.id}: ${entries.length} pages zipped, ${failed} failed, ${(buf.length / 1024) | 0}KB`);
  } catch (err) {
    if (err.code === 'LIMIT_REACHED') return sendLimitReached(res, err);
    next(err);
  }
});

// Global concurrency gate for upstream image fetches: MangaDex at-home
// servers rate-limit per IP, so we serialize bursts (max 5 in flight).
let inflight = 0;
const waiters = [];
async function acquire() {
  if (inflight < 5) {
    inflight += 1;
    return;
  }
  await new Promise((r) => waiters.push(r));
  inflight += 1;
}
function release() {
  inflight -= 1;
  const next = waiters.shift();
  if (next) next();
}

/**
 * Fetch a page from MangaDex with disk cache + gentle retries.
 * - cache-first: an already-fetched page never hits MangaDex again
 * - 429 handling is IMPORTANT: MangaDex's DDoS protection issues an IP ban
 *   if you keep sending requests while rate-limited. On 429 we wait a long
 *   cooldown (45s, or the Retry-After hint) and retry exactly ONCE.
 * - 5xx: one quick retry.
 * - `quick` mode (ZIP downloads): fails immediately on rate-limit responses
 *   so a download doesn't crawl for minutes when the CDN is throttling.
 * Returns {buf, type} or null.
 */
async function fetchUpstream(url, quick = false) {
  const cached = imageCache.get(url);
  if (cached) {
    return { buf: cached, type: 'image/jpeg', fromCache: true };
  }
  await acquire();
  try {
    // attempt 1 — only a successful image (result.buf) counts as success
    let result = await attemptFetch(url);
    if (result && result.buf) return result;

    // attempt 2 — optional fallback proxy (admin-configurable template with
    // {url}), e.g. a Consumet-style endpoint or your own mirror. Result is
    // cached under the ORIGINAL MangaDex URL so re-reads never hit it again.
    const fallbackProxy = await getSetting('image_fallback_proxy', config.imageFallbackProxy);
    if (fallbackProxy) {
      const fbUrl = fallbackProxy.replace('{url}', encodeURIComponent(url));
      const fb = await attemptFetch(fbUrl);
      if (fb && fb.buf) {
        imageCache.set(url, fb.buf);
        return { buf: fb.buf, type: fb.type, fromFallback: true };
      }
    }

    if (quick) return null; // ZIP mode: don't crawl through rate limits

    // attempt 3 — retry network errors & 5xx quickly, rate limits slowly
    const status = result ? result.status : 0;
    if (status === 0 || status === 429 || status >= 500) {
      await delay(status === 429 ? 45000 : 1500);
      result = await attemptFetch(url);
      if (result && result.buf) return result;
    }
    return null;
  } finally {
    release();
  }
}

/** Single fetch attempt → {buf,type} | {status} | null (network error).
 *  Sends the MangaDex-required headers: browser-like User-Agent and
 *  Referer: https://mangadex.org/. Rejects non-image responses (MangaDex's
 *  CDN answers 200 with an HTML rate-limit page when an IP is throttled —
 *  serving that HTML as an image must never happen). A hard timeout keeps
 *  blackholed hosts (firewalled IPs) from hanging the pipeline. */
async function attemptFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': config.mangadex.imageUserAgent,
        Referer: config.mangadex.imageReferer,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (upstream.ok) {
      const ct = (upstream.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image/')) return { status: 415 }; // not an image
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length < 100) return null;
      imageCache.set(url, buf);
      return { buf, type: ct || 'image/jpeg' };
    }
    return { status: upstream.status };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/reader/image/:chapterId/:index — opaque manga page image proxy.
 * Order of attempts:
 *   1. legacy stored URL (if any)
 *   2. dataSaver URL on the stored base
 *   3. full-quality URL on the stored base
 *   4. re-resolve at-home (new base) → dataSaver → full-quality
 * Falls back to 404 only when every attempt fails.
 */
router.get('/image/:chapterId/:index', imageLimiter, async (req, res) => {
  try {
    const chapter = await db.prepare('SELECT * FROM manga_chapters WHERE id = ?').get(req.params.chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    const index = parseInt(req.params.index, 10);
    const pages = mangadex.normalizePages(chapter.pages_json);
    const entry = pages[index];

    const candidates = [];
    if (entry && entry.u) {
      candidates.push(entry.u);
    } else if (entry && entry.h && entry.f && entry.b) {
      candidates.push(`${entry.b}/dataSaver/${entry.h}/${entry.f}`);
      candidates.push(`${entry.b}/data/${entry.h}/${entry.f}`);
    }

    // 1–3: try stored candidates (quick mode: fail fast when rate-limited,
    // so the mirror CDN fallback kicks in without long cooldowns)
    for (const url of candidates) {
      const img = await fetchUpstream(url, true);
      if (img) return sendImage(res, img);
    }

    // 4: base URL may have rotated — re-resolve via at-home and retry
    if (chapter.md_chapter_id) {
      const fresh = await mangadex.resolveChapterPages(chapter.id);
      const freshEntry = fresh && fresh[index];
      if (freshEntry) {
        for (const url of [
          `${freshEntry.b}/dataSaver/${freshEntry.h}/${freshEntry.f}`,
          `${freshEntry.b}/data/${freshEntry.h}/${freshEntry.f}`,
        ]) {
          const img = await fetchUpstream(url, true);
          if (img) return sendImage(res, img);
        }
      }
    }

    // 5: mirror CDN fallback (mangapill provider — enabled via sources registry)
    const mirrorSrc = await db.prepare("SELECT enabled FROM sources WHERE id = 'mangapill'").get();
    if (mirrorSrc && mirrorSrc.enabled) {
      try {
        const mirrorPages = await mirrorManga.getChapterImages(chapter.id);
        const mirrorUrl = mirrorPages && mirrorPages[index];
        if (mirrorUrl) {
          const cacheKey = `mirror:${chapter.id}:${index}`;
          const cached = imageCache.get(cacheKey);
          if (cached) return sendImage(res, { buf: cached, type: 'image/jpeg', fromCache: true, fromFallback: true });
          const img = await mirrorManga.fetchMirrorImage(mirrorUrl);
          if (img) {
            imageCache.set(cacheKey, img.buf);
            return sendImage(res, { ...img, fromFallback: true });
          }
        }
      } catch {
        /* mirror failed — fall through */
      }
    }

    res.status(404).json({ error: 'Image unavailable — tap retry to reload' });
  } catch (err) {
    console.error('[reader] image route error:', err);
    res.status(502).json({ error: 'Image fetch failed' });
  }
});

function sendImage(res, img) {
  res.setHeader('Content-Type', img.type);
  res.setHeader('Content-Length', img.buf.length);
  res.setHeader('Cache-Control', img.fromCache ? 'public, max-age=604800, immutable' : 'public, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(img.buf);
}

/** GET /api/downloads/status — current allowance for the caller. */
router.get('/downloads/status', optionalAuth, async (req, res, next) => {
  try {
    res.json({ download: await downloadLimiter.status(req.user ? req.user.id : null, clientIp(req)) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/downloads/reward — user watched the rewarded ad → grant token. */
router.post('/downloads/reward', optionalAuth, async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Login required to earn extra downloads' });
  try {
    res.json(await downloadLimiter.createRewardToken(req.user.id));
  } catch (err) {
    if (err.code === 'AD_SLOT_DISABLED') {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

/** POST /api/downloads/redeem — redeem a grant token for +5 downloads. */
router.post('/downloads/redeem', optionalAuth, async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Login required' });
  try {
    const token = String(req.body.token || '');
    if (!token) return res.status(400).json({ error: 'Missing token' });
    res.json({ download: await downloadLimiter.redeemReward(req.user.id, token) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
