'use strict';

/**
 * Mirror CDN image providers — chapter IMAGE fallback when MangaDex
 * at-home nodes are unreachable (rate-limited / blocked).
 *
 * Providers are config-driven (server/config/mirror-sources.json): any
 * manga-reading site can be added with CSS selectors + its image CDN host.
 * Each chapter's resolved image list is cached in
 * `manga_chapters.mirror_pages_json` (scraped once per chapter).
 */
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const config = require('../config');

const SOURCES_FILE = path.join(__dirname, '..', 'config', 'mirror-sources.json');
const providers = (JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')).providers || []).filter((p) => p.enabled);
const UA = config.mangadex.imageUserAgent;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`mirror ${res.status} for ${url}`);
  return res.text();
}

function chapterNumberFromUrl(href, pattern) {
  if (!pattern) return null;
  const m = href.match(new RegExp(pattern));
  return m ? parseFloat(m[1]) : null;
}

/** Resolve one chapter's ordered image URLs using a single provider. */
async function providerChapterImages(provider, title, chapterNumber) {
  const q = encodeURIComponent(String(title || '').replace(/[^\w\s-]/g, ' ').trim());
  if (!q) return null;
  const $ = cheerio.load(await fetchHtml(provider.baseUrl + provider.search.url.replace('{q}', q)));
  const link = $(provider.search.itemSelector).first().attr(provider.search.linkAttr || 'href');
  if (!link) return null;
  const mangaUrl = link.startsWith('http') ? link : provider.baseUrl + link;

  const $m = cheerio.load(await fetchHtml(mangaUrl));
  const links = [];
  $m(provider.chapters.selector).each((_, el) => {
    const h = $m(el).attr(provider.chapters.linkAttr || 'href');
    if (h && !links.includes(h)) links.push(h);
  });
  if (!links.length) return null;

  let target = null;
  const wanted = parseFloat(chapterNumber) || 0;
  for (const l of links) {
    const n = chapterNumberFromUrl(l, provider.chapters.numberPattern);
    if (n != null && wanted > 0 && Math.abs(n - wanted) < 0.01) {
      target = l;
      break;
    }
  }
  if (!target) target = links[0];
  if (!target) return null;

  const $c = cheerio.load(await fetchHtml(target.startsWith('http') ? target : provider.baseUrl + target));
  const hosts = provider.images.hosts || [provider.imgHost];
  const imgs = [];
  $c(provider.images.selector).each((_, el) => {
    const src = $c(el).attr(provider.images.attr || 'src') || $c(el).attr('data-src') || '';
    if (hosts.some((h) => src.includes(h))) imgs.push(src);
  });
  return imgs.length ? imgs : null;
}

/** Resolve + cache a chapter's ordered image URLs (providers in order). */
async function getChapterImages(chapterId) {
  const chapter = db.prepare('SELECT * FROM manga_chapters WHERE id = ?').get(chapterId);
  if (!chapter) return null;

  if (chapter.mirror_pages_json && chapter.mirror_pages_json !== '[]') {
    try {
      return JSON.parse(chapter.mirror_pages_json);
    } catch {
      /* re-resolve */
    }
  }
  const manga = db.prepare('SELECT title FROM manga WHERE id = ?').get(chapter.manga_id);
  if (!manga || !manga.title) return null;

  for (const provider of providers) {
    try {
      const imgs = await providerChapterImages(provider, manga.title, chapter.chapter_number);
      if (imgs) {
        db.prepare('UPDATE manga_chapters SET mirror_pages_json = ? WHERE id = ?').run(JSON.stringify(imgs), chapterId);
        return imgs;
      }
    } catch {
      /* try next provider */
    }
  }
  return null;
}

/** Fetch a mirror image with the CDN-required headers. */
async function fetchMirrorImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://mangapill.com/' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null;
    return { buf, type: res.headers.get('content-type') || 'image/jpeg' };
  } catch {
    return null;
  }
}

module.exports = { getChapterImages, fetchMirrorImage, providers };
