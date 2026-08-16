'use strict';

/**
 * Multi-source registry + health checks.
 * Every provider has an enable toggle, a priority order and a live health
 * status (ok / slow / down / degraded). Enabled sources are used in priority
 * order; the image proxy and sync code fall back to the next provider
 * automatically (see routes/reader.js fetchUpstream + the IMAGE_FALLBACK_PROXY
 * / alt_api_base admin settings).
 *
 * Note (2026): several public providers targeted by this project are closed —
 * Consumet (DMCA, HTTP 451), ComicK public API (now serves its SPA only),
 * MangaFeed (never a public API). They stay registered (disabled) so they
 * activate automatically the moment an endpoint returns.
 */
const { db } = require('../db');
const config = require('../config');

const HEALTH_PING_MS = 6000;

function listSources() {
  return db.prepare('SELECT * FROM sources ORDER BY priority ASC, id ASC').all().map((s) => ({
    ...s,
    enabled: !!s.enabled,
  }));
}

function setSource(id, { enabled, priority } = {}) {
  const src = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!src) return null;
  if (enabled !== undefined) db.prepare('UPDATE sources SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  if (priority !== undefined) {
    const p = parseInt(priority, 10);
    if (!Number.isFinite(p) || p < 1 || p > 100) throw new Error('priority must be 1–100');
    db.prepare('UPDATE sources SET priority = ? WHERE id = ?').run(p, id);
  }
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
}

async function ping(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs || HEALTH_PING_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init.fetchInit, signal: controller.signal });
    return { ok: true, status: res.status, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Persist + return a source's health entry. */
function classify(sourceId, result, baseStatus) {
  const latency = result.latencyMs || 0;
  let status = baseStatus;
  if (result.ok && baseStatus === 'ok' && latency > 3000) status = 'slow';
  db.prepare('UPDATE sources SET status = ?, latency_ms = ?, last_check = ? WHERE id = ?').run(
    status,
    latency,
    new Date().toISOString(),
    sourceId
  );
  return { status, latency_ms: latency };
}

/** Health probe per source → { status, latency_ms }. */
async function checkSource(id) {
  const ua = config.mangadex.imageUserAgent;
  switch (id) {
    case 'mangadex': {
      const r = await ping('https://api.mangadex.org/ping', {
        fetchInit: { headers: { 'User-Agent': config.mangadex.userAgent } },
      });
      return classify(id, r, r.ok && r.status === 200 ? 'ok' : 'down');
    }
    case 'comick': {
      // API mode closed (SPA HTML) — the site itself is reachable → degraded
      const r = await ping('https://comick.io/', { fetchInit: { headers: { 'User-Agent': ua } } });
      return classify(id, r, r.ok ? 'degraded' : 'down');
    }
    case 'mangapill': {
      const r = await ping('https://mangapill.com/', { fetchInit: { headers: { 'User-Agent': ua } } });
      return classify(id, r, r.ok ? 'ok' : 'down');
    }
    case 'consumet': {
      const r = await ping('https://api.consumet.org/', { fetchInit: { headers: { 'User-Agent': ua } } });
      return classify(id, r, r.ok ? 'degraded' : 'down'); // 451 = legally blocked
    }
    case 'anilist': {
      const r = await ping('https://graphql.anilist.co', {
        fetchInit: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': ua },
          body: JSON.stringify({ query: '{ Page(perPage: 1) { media(type: MANGA) { id } } }' }),
        },
      });
      return classify(id, r, r.ok && r.status === 200 ? 'ok' : 'down');
    }
    case 'mangaupdates': {
      const r = await ping('https://api.mangaupdates.com/', { fetchInit: { headers: { 'User-Agent': ua } } });
      // 2xx/4xx means the API host is reachable (some endpoints need keys)
      return classify(id, r, r.ok && r.status < 500 ? 'ok' : 'down');
    }
    default:
      return classify(id, { ok: false, latencyMs: 0 }, 'unknown');
  }
}

/** Run health checks for all sources and persist results. */
async function checkAll() {
  for (const s of listSources()) {
    await checkSource(s.id);
  }
  return listSources();
}

module.exports = { listSources, setSource, checkAll, checkSource };
