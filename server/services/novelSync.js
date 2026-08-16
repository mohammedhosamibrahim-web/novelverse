'use strict';

/**
 * Novel scraping pipeline — pluggable, configuration-driven adapters.
 *
 * Each source in server/config/novel-sources.json declares CSS selectors and
 * URL templates; the generic adapter below turns those into search / toc /
 * chapter fetchers. To add a source: copy the template, set `enabled: true`,
 * fill in selectors — no code changes.
 *
 * Legal note: only scrape sources you are entitled to use (public-domain
 * works, licensed feeds, or sites whose terms permit it). The platform
 * stores fetched content in its own DB and serves it through sanitized
 * routes; you are responsible for the sources you configure.
 */
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { sanitizeContent } = require('../middleware/sanitize');
const config = require('../config');

const SOURCES_FILE = path.join(__dirname, '..', 'config', 'novel-sources.json');
const sources = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')).sources || [];

function listSources() {
  return sources.map((s) => ({ id: s.id, name: s.name, enabled: !!s.enabled }));
}

class GenericAdapter {
  constructor(cfg) {
    this.cfg = cfg;
  }

  abs(url) {
    return new URL(url, this.cfg.baseUrl).toString();
  }

  async request(url) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': config.mangadex.userAgent,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`Source ${this.cfg.id} returned ${res.status} for ${url}`);
    return res.text();
  }

  async search(query) {
    const url = this.abs(this.cfg.search.url.replace('{query}', encodeURIComponent(query)));
    const $ = cheerio.load(await this.request(url));
    const items = [];
    $(this.cfg.search.itemSelector).each((_, el) => {
      const $el = $(el);
      const link = $el.find(this.cfg.search.linkSelector).first();
      const title = ($el.find(this.cfg.search.titleSelector).first().text() || link.text() || '').trim();
      const href = link.attr('href');
      if (!title || !href) return;
      const cover = $el.find(this.cfg.search.coverSelector).first().attr('src');
      items.push({
        title,
        tocUrl: this.abs(href),
        coverUrl: cover ? this.abs(cover) : '',
      });
    });
    return items.slice(0, 50);
  }

  async fetchToc(tocUrl) {
    const url = this.abs(this.cfg.toc.url.replace('{tocUrl}', tocUrl));
    const $ = cheerio.load(await this.request(url));
    const title = $(this.cfg.toc.titleSelector).first().text().trim() || 'Untitled';
    const chapters = [];
    $(this.cfg.toc.chapterSelector).each((i, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      if (!href) return;
      chapters.push({
        index: i + 1,
        title: ($el.text() || `Chapter ${i + 1}`).trim().slice(0, 200),
        url: this.abs(href),
      });
    });
    return { title, chapters };
  }

  async fetchChapter(chapterUrl) {
    const url = this.abs(this.cfg.chapter.url.replace('{chapterUrl}', chapterUrl));
    const $ = cheerio.load(await this.request(url));
    const title = ($(this.cfg.chapter.titleSelector).first().text() || '').trim();
    const content = $(this.cfg.chapter.contentSelector).first();
    content.find('script, style, iframe, noscript, .ad, .ads, [class*=advert], [id*=ad]').remove();
    return { title: title || 'Untitled', content: content.html() || '' };
  }
}

function getAdapter(sourceId) {
  const cfg = sources.find((s) => s.id === sourceId && s.enabled);
  if (!cfg) return null;
  return new GenericAdapter(cfg);
}

/** Live search against a source (no DB writes). */
async function searchSource(sourceId, query) {
  const adapter = getAdapter(sourceId);
  if (!adapter) {
    const err = new Error('Source not found or disabled');
    err.code = 'SOURCE_UNAVAILABLE';
    throw err;
  }
  const results = await adapter.search(query);
  return { sourceId, results };
}

/** Import a novel + its full table of contents. */
async function importNovel(sourceId, { tocUrl, title, coverUrl, author }) {
  const adapter = getAdapter(sourceId);
  if (!adapter) {
    const err = new Error('Source not found or disabled');
    err.code = 'SOURCE_UNAVAILABLE';
    throw err;
  }
  const toc = await adapter.fetchToc(tocUrl);
  const info = db
    .prepare(
      'INSERT INTO novels (title, author, description, cover_url, source, source_id, toc_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      title || toc.title,
      author || '',
      '',
      coverUrl || '',
      sourceId,
      tocUrl,
      tocUrl
    );
  const novelId = Number(info.lastInsertRowid);
  const insertChapter = db.prepare(
    'INSERT OR IGNORE INTO novel_chapters (novel_id, chapter_index, title, url) VALUES (?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (const ch of toc.chapters) {
      insertChapter.run(novelId, ch.index, ch.title, ch.url);
    }
  });
  tx();
  return { novelId, title: title || toc.title, chapterCount: toc.chapters.length };
}

/** Fetch + cache a chapter's content (network first time, DB afterwards). */
async function getNovelChapterContent(novelChapterId, chapterUrl) {
  const cached = db.prepare('SELECT content, fetched_at FROM novel_chapters WHERE id = ?').get(novelChapterId);
  if (cached && cached.fetched_at) return cached.content;
  const adapter = getAdapter(
    db.prepare('SELECT source FROM novels WHERE id = (SELECT novel_id FROM novel_chapters WHERE id = ?)').get(novelChapterId).source
  );
  if (!adapter) throw Object.assign(new Error('Source unavailable'), { code: 'SOURCE_UNAVAILABLE' });
  const parsed = await adapter.fetchChapter(chapterUrl);
  const content = sanitizeContent(parsed.content);
  db.prepare("UPDATE novel_chapters SET content = ?, fetched_at = datetime('now') WHERE id = ?").run(
    content,
    novelChapterId
  );
  return content;
}

module.exports = { listSources, searchSource, importNovel, getNovelChapterContent };
