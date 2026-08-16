'use strict';

/**
 * AniList GraphQL client — manga/anime metadata provider.
 * Used for: anime search/detail (with trailer + description as required),
 * manga metadata enrichment. Does NOT host chapter images (metadata only).
 */
const config = require('../config');

const API = 'https://graphql.anilist.co';
const UA = 'NovelVerse/1.0 (https://accio.com)';

async function gql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`AniList ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(`AniList error: ${json.errors[0].message}`);
  }
  return json.data;
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
    .slice(0, 2000);
}

function mapMedia(m) {
  return {
    id: m.id,
    title: (m.title && (m.title.romaji || m.title.english || m.title.native)) || 'Untitled',
    nativeTitle: (m.title && m.title.native) || '',
    description: stripHtml(m.description),
    cover: (m.coverImage && m.coverImage.extraLarge) || (m.coverImage && m.coverImage.large) || '',
    banner: m.bannerImage || '',
    trailer: m.trailer && m.trailer.site === 'youtube' ? { youtubeId: m.trailer.id } : null,
    status: m.status || '',
    episodes: m.episodes || null,
    chapters: m.chapters || null,
    score: m.averageScore || null,
    format: m.format || '',
  };
}

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  description
  coverImage { large extraLarge }
  bannerImage
  trailer { id site }
  status
  episodes
  chapters
  averageScore
  format
`;

/** Search anime (or manga) by title. */
async function searchMedia(q, type = 'ANIME', page = 1, perPage = 20) {
  const data = await gql(
    `query ($q: String, $type: MediaType, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage }
        media(search: $q, type: $type) { ${MEDIA_FIELDS} }
      }
    }`,
    { q, type, page, perPage }
  );
  return {
    items: (data.Page.media || []).map(mapMedia),
    total: (data.Page.pageInfo && data.Page.pageInfo.total) || 0,
    page,
    pages: (data.Page.pageInfo && data.Page.pageInfo.lastPage) || 1,
  };
}

/** Get one title by AniList id. */
async function getMedia(id, type = 'ANIME') {
  const data = await gql(
    `query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { ${MEDIA_FIELDS} } }`,
    { id, type }
  );
  return data.Media ? mapMedia(data.Media) : null;
}

/** Popular manga pages (metadata sync source — no chapter images). */
async function getPopularManga(page = 1, perPage = 50) {
  const data = await gql(
    `query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total lastPage }
        media(type: MANGA, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} }
      }
    }`,
    { page, perPage }
  );
  return {
    items: (data.Page.media || []).map(mapMedia),
    total: (data.Page.pageInfo && data.Page.pageInfo.total) || 0,
    page,
    pages: (data.Page.pageInfo && data.Page.pageInfo.lastPage) || 1,
  };
}

module.exports = { searchMedia, getMedia, getPopularManga, gql };
