'use strict';

/**
 * Mirror CDN image provider (Mangapill) — chapter IMAGE fallback.
 * When MangaDex at-home nodes are unreachable (rate-limited / blocked),
 * chapter pages are resolved through the Mangapill mirror (its images are
 * served from cdn.readdetectiveconan.com, a public CDN).
 *
 * Matching: manga title → mangapill search → chapter URL (chapter number) →
 * image list. Results are cached per chapter in `manga_chapters.mirror_pages_json`
 * so each chapter is scraped only once; image bytes are disk-cached too.
 */
const cheerio = require('cheerio');
const { db } = require('../db');
const config = require('../config');

const BASE = 'https://mangapill.com';
const IMG_HOST = 'cdn.readdetectiveconan.com';
const UA = config.mangadex.imageUserAgent;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`mirror ${res.status} for ${url}`);
  return res.text();
}

function chapterNumberFromUrl(href) {
  const m = href.match(/chapter-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

async function findMangaPage(title) {
  const q = encodeURIComponent(String(title || '').replace(/[^\w\s-]/g, ' ').trim());
  if (!q) return null;
  const $ = cheerio.load(await fetchHtml(`${BASE}/search?q=${q}`));
  const link = $('a[href*="/manga/"]').first().attr('href');
  return link ? BASE + link : null;
}

/** Resolve + cache the ordered image URLs for a chapter via the mirror. */
async function getChapterImages(chapterId) {
  const chapter = db.prepare('SELECT * FROM manga_chapters WHERE id = ?').get(chapterId);
  if (!chapter) return null;

  const cached = chapter.mirror_pages_json;
  if (cached && cached !== '[]') {
    try {
      return JSON.parse(cached);
    } catch {
      /* re-resolve */
    }
  }

  const manga = db.prepare('SELECT title FROM manga WHERE id = ?').get(chapter.manga_id);
  if (!manga || !manga.title) return null;

  const mangaUrl = await findMangaPage(manga.title);
  if (!mangaUrl) return null;

  const $m = cheerio.load(await fetchHtml(mangaUrl));
  const links = [];
  $m('a[href*="/chapters/"]').each((_, el) => {
    const h = $m(el).attr('href');
    if (h && !links.includes(h)) links.push(h);
  });
  if (!links.length) return null;

  // match by chapter number; fall back to the newest chapter
  let target = null;
  const wanted = parseFloat(chapter.chapter_number) || 0;
  for (const l of links) {
    const n = chapterNumberFromUrl(l);
    if (n != null && wanted > 0 && Math.abs(n - wanted) < 0.01) {
      target = l;
      break;
    }
  }
  if (!target) target = links[0];
  if (!target) return null;

  const $c = cheerio.load(await fetchHtml(BASE + target));
  const imgs = [];
  $c('img').each((_, el) => {
    const src = $c(el).attr('src') || $c(el).attr('data-src') || '';
    if (src.includes(IMG_HOST)) imgs.push(src);
  });
  if (!imgs.length) return null;

  db.prepare('UPDATE manga_chapters SET mirror_pages_json = ? WHERE id = ?').run(JSON.stringify(imgs), chapterId);
  return imgs;
}

/** Fetch a mirror image with the CDN-required headers. */
async function fetchMirrorImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: BASE + '/' },
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

module.exports = { getChapterImages, fetchMirrorImage };
