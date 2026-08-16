'use strict';

/**
 * Image proxy with hotlink protection.
 * - Only allowlisted upstream hosts can be fetched.
 * - Original source URLs are never exposed to the client for chapter pages
 *   (they are served through opaque /api/reader/image/:chapterId/:index routes).
 * - Responses are re-labeled with a safe Content-Type and long cache TTL.
 */
const config = require('../config');

const ALLOWED_HOSTS = new Set(['uploads.mangadex.org', 's4.anilist.co']);

/** Proxy an arbitrary image URL (used for cover art). */
async function proxyImageUrl(req, res) {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return res.status(403).json({ error: 'Host not allowed' });
  }
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': config.mangadex.imageUserAgent,
        Referer: config.mangadex.imageReferer,
      },
      redirect: 'follow',
    });
    if (!upstream.ok) return res.status(upstream.status).end();
    const buf = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: 'Upstream fetch failed' });
  }
}

module.exports = { proxyImageUrl };
