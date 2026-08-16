'use strict';

/**
 * Server-side disk cache for proxied chapter images.
 * MangaDex at-home servers rate-limit per IP (~10 req/min); since the proxy
 * is a single shared IP, caching image BYTES here means each chapter page is
 * fetched from MangaDex only once and served from disk afterwards.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const cacheDir = path.join(path.dirname(config.dbPath), 'image-cache');

function ensureDir() {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function cachePath(url) {
  return path.join(cacheDir, crypto.createHash('sha1').update(url).digest('hex') + '.img');
}

function get(url) {
  try {
    return fs.readFileSync(cachePath(url));
  } catch {
    return null;
  }
}

function set(url, buf) {
  try {
    ensureDir();
    fs.writeFileSync(cachePath(url), buf);
  } catch {
    /* ignore */
  }
}

/** Prune entries older than `maxAgeMs` (called once at boot). */
function prune(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  try {
    ensureDir();
    const now = Date.now();
    for (const f of fs.readdirSync(cacheDir)) {
      const p = path.join(cacheDir, f);
      try {
        if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

module.exports = { get, set, prune, cacheDir };
