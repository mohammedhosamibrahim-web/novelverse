# NovelVerse — Automated Manga / Manhwa / Manhua / Novel Platform

A fully automated web reading platform with:

- **Multilingual (i18n)** — full **English + Arabic** interface with an EN | عربي switcher in the header; Arabic renders in **RTL**, preference persists in localStorage (auto-detects browser language).
- **Manga / Manhwa / Manhua** — **bulk auto-sync** from the public [MangaDex API](https://api.mangadex.org/docs/): multi-page pulls of most-followed + recently-updated manga (150+ titles per run), scheduled **cron-style job** (default every 3h) that also refreshes existing series' chapter lists.
- **Chinese / web novels** — pluggable, config-driven scraping pipeline (add a source with CSS selectors, no code changes).
- **First-account-is-Super-Admin** — the very first registration gets `super_admin` with full site control (role management for Moderators/Users).
- **Dynamic daily download limit** — 11 chapters / 24h per user, rewarded-ad wall unlocks **+5** for 24h.
- **Ad Management Panel** — insert/toggle/replace ad code (AdSterra, AdSense, custom banners) in 7 slots: `header`, `reader_top`, `reader_bottom`, `in_reader` (every N images/paragraphs), `download_wall` (rewarded), `sidebar`, `footer`.
- **Security** — bcrypt hashing, JWT httpOnly cookies, CSRF double-submit, per-IP rate limiting, XSS sanitization, parameterized SQL, image proxy with hotlink protection, RBAC middleware.
- **Self-healing chapter images** — pages resolve lazily on first read, the image proxy tries dataSaver → full-quality → re-resolves the MangaDex at-home base URL when it rotates, caches image bytes on disk (each page fetched from MangaDex only once), retries transient failures with cooldown, and the reader auto-retries failed images with backoff.
- **Readers** — mobile-first dark UI (Tailwind): novel reader with Dark/Sepia/Light themes, font-size control, progress persistence; manga reader with vertical scroll + single/double page modes.
- **PWA** — manifest + service worker, installable ("Add to Home Screen"), offline app-shell caching, chapter-level comments with spoiler tags, bookmarks, reading history.

---

## Tech stack

| Layer    | Choice                                             |
| -------- | -------------------------------------------------- |
| Backend  | Node.js 18+, Express, SQLite (`better-sqlite3`)    |
| Frontend | React 18 + Vite + Tailwind CSS (PWA)               |
| Auth     | bcryptjs + JWT (httpOnly cookie) + CSRF            |

One process serves the API **and** the built SPA — deploys free on Render/Railway/Vercel.

---

## Quick start

```bash
npm install
cp .env.example .env          # then edit JWT_SECRET
npm run build                 # build the React client
npm start                     # http://localhost:3000
```

Development (hot reload):

```bash
npm run dev                   # server :3000 + Vite :5173 (proxy → /api)
```

**Register the first account** — it automatically becomes the Super Admin.

Smoke tests:

```bash
npm run smoke                 # limiter unit tests + full API E2E
```

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | dev-only | **Change in production** (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | `7d` | Session lifetime |
| `DB_PATH` | `./data/app.db` | SQLite file location |
| `MANGADEX_UA` | built-in | MangaDex requires a descriptive User-Agent (include contact) |
| `MANGADEX_SYNC` | `true` | `false` disables the scheduled sync |
| `MANGADEX_SYNC_INTERVAL_MS` | `10800000` (3h) | Cron interval for the background sync job |
| `MANGADEX_SYNC_POPULAR_PAGES` | `3` | Pages of most-followed manga per bulk run (× per page) |
| `MANGADEX_SYNC_LATEST_PAGES` | `2` | Pages of recently-updated manga per bulk run |
| `MANGADEX_SYNC_PER_PAGE` | `50` | Manga per page (max 100) |
| `MANGADEX_AT_HOME_DELAY_MS` | `150` | Pacing between MangaDex requests (rate-limit safety) |
| `MANGADEX_REFRESH_BATCH` | `10` | Existing manga whose chapters refresh per scheduled run |
| `RATE_LIMIT_API_PER_MIN` | `60` | Per-IP API limit |
| `RATE_LIMIT_AUTH_PER_MIN` | `10` | Auth endpoint limit (brute-force guard) |
| `RATE_LIMIT_IMAGE_PER_MIN` | `120` | Image proxy limit |

The download-limit values (`download_limit`, `reward_bonus`, …) default to 11 / 5 / 24h and are **editable live from Admin → Settings** (persisted in the DB).

---

## Download limit & rewarded ads

- Every chapter fetch (manga pages list / novel chapter text) is a counted download — that's the bandwidth cost.
- Per-user rolling 24h window, **11 chapters**. Anonymous users are bucketed by IP (same cap, no ads).
- Re-reading the same chapter within the window is free (deduped).
- When the cap is hit the reader shows the **Download Wall** (`download_wall` slot):
  1. `POST /api/reader/downloads/reward` → issues a one-time grant token (5 min TTL) once the ad slot is enabled.
  2. The ad plays (demo: 5s countdown). With a real network (AdSterra/AdSense rewarded), call the unlock from the SDK's `onRewarded` callback.
  3. `POST /api/reader/downloads/redeem { token }` → **+5 downloads valid 24h**.
- `GET /api/reader/downloads/status` → `{ used, limit, bonus, remaining, requiresAd }`.

---

## Ad management

In **Admin → Ad Management**:

- **header** — all page headers
- **reader_top / reader_bottom** — above/below the reader
- **in_reader** — every N images (manga) / paragraphs (novel); N is configurable per slot
- **download_wall** — the rewarded-ad container (enabling it is required for the +5 unlock)
- **sidebar / footer** — global placement

Paste ad code as HTML/JS (it is injected as-is — this is the *trusted* Super Admin panel; user-generated content is always sanitized).

---

## Novel sources (scraping pipeline)

Sources are defined in `server/config/novel-sources.json` — pure configuration:

```jsonc
{
  "id": "my-source", "name": "My Source", "baseUrl": "https://example.com", "enabled": true,
  "search":  { "url": "/search?q={query}", "itemSelector": "li.item", "titleSelector": "a.title", "linkSelector": "a.title", "coverSelector": "img" },
  "toc":     { "url": "{tocUrl}", "titleSelector": "h1", "chapterSelector": "ul.list a" },
  "chapter": { "url": "{chapterUrl}", "titleSelector": "h1", "contentSelector": "#content" }
}
```

- Admin → Content Sync → **Novel import**: pick a source, paste a TOC URL (or use the source's live search via `GET /api/novels/search?source=&q=`).
- Chapter text is fetched lazily on first read, **sanitized**, and cached in the DB.

> ⚠️ **Legal note:** only configure sources you are entitled to use (public-domain works, licensed feeds, or sites whose terms permit it). You are responsible for the sources you scrape. The platform is content-agnostic infrastructure.

---

## Multilingual support (i18n)

- **Languages:** English + Arabic, switchable from the header (`EN | عربي`).
- **RTL/LTR:** Arabic flips the whole UI to RTL automatically; the manga page area stays LTR for correct page order.
- **Persistence:** the choice is stored in `localStorage` (`lang`) and auto-detected from the browser on first visit.
- Adding a language: extend the dictionaries in `client/src/i18n.jsx` (one flat key per string, `{var}` interpolation supported).

## Bulk sync & scheduling

- **Modes** (Admin → Content Sync):
  - **Sync popular (bulk)** — pulls `MANGADEX_SYNC_POPULAR_PAGES × MANGADEX_SYNC_PER_PAGE` most-followed titles.
  - **Sync latest updates** — recently-updated titles (new releases).
  - **Refresh existing chapters** — re-fetches feeds of the oldest-synced manga to catch new chapters.
- The **scheduled cron job** (default every 3 hours) runs a `full` pass (1 popular page + 1 latest page + refresh batch) automatically.
- Bulk sync stores chapter *metadata* only — image pages resolve lazily on first read, so a big library syncs quickly without hammering MangaDex's at-home servers.

## Chapter images: self-healing pipeline

1. **Lazy resolution** — a chapter with no stored pages resolves them via the MangaDex at-home API on first read (stored as `{hash, file, base}` entries). `GET /api/reader/chapter/:id` (and the manga pages endpoint) call `/at-home/server/:id` and return the **hash + full page filenames** (`atHome` field) to the frontend together with opaque page routes.
1. **Required headers** — every proxied MangaDex image request (chapter pages and covers) sends `Referer: https://mangadex.org` + a descriptive `User-Agent`, per MangaDex's CDN requirements.
2. **Disk cache** — every successfully fetched page is cached as bytes in `data/image-cache/`; re-reads never touch MangaDex again (also survives the at-home base URL rotating).
3. **Retry chain** — dataSaver → full-quality → re-resolve at-home → retry once after a cooldown (45s on rate-limit responses; MangaDex bans IPs that keep hammering while 429'd, so retries are deliberately gentle).
4. **Client auto-retry** — the manga reader retries failed images 3× with backoff (1.5s/3s/6s) plus a manual Retry button; external (licensed) chapters show a "read on source" link.

> ⚠️ MangaDex rate-limits at-home image nodes **per IP**. On shared/datacenter IPs (some free hosting, VPNs) you may see 429s — the cache + retry system absorbs this, and a dedicated server IP works normally.

## Security implementation

- **Passwords**: bcrypt (10 rounds, `bcryptjs`).
- **Sessions**: JWT in an httpOnly, SameSite=Lax cookie; role is loaded fresh from the DB on every request so admin changes apply instantly.
- **CSRF**: double-submit — the client echoes the `csrf` cookie in `X-CSRF-Token` on every state-changing request; mismatches → 403.
- **Anti-scraping**: `express-rate-limit` per IP on all `/api` routes (stricter on auth).
- **XSS**: comment content sanitized with `sanitize-html` (scripts/events stripped, safe links only); scraped novel content goes through a stricter allow-list.
- **SQL injection**: 100% parameterized statements.
- **Hotlink protection**: chapter image URLs are stored server-side and served via opaque `/api/reader/image/:chapterId/:index` routes; cover art goes through an allowlisted proxy; upstream hosts are restricted (`uploads.mangadex.org`).
- **RBAC**: `requireAuth` + `requireRole('super_admin')` middleware on admin routes; moderators can moderate comments.

---

## Project structure

```
├── server/
│   ├── index.js               # Express app + scheduled sync
│   ├── config.js              # env configuration
│   ├── db.js                  # SQLite schema + seed
│   ├── middleware/            # auth, csrf, rateLimit, sanitize
│   ├── routes/                # auth, manga, novel, reader, comments, user, ads, admin, proxy
│   ├── services/              # mangadex, novelSync, downloadLimiter, imageProxy
│   └── config/novel-sources.json
├── client/
│   ├── src/                   # React SPA (pages, components, context)
│   └── public/                # manifest.json, sw.js, icons, offline.html
└── scripts/                   # smoke tests, icon generator
```

---

## Deployment (Render free tier)

1. Push to GitHub.
2. **New + → Web Service** → import repo (or use `render.yaml` via Blueprint).
3. Free plan: `npm install && npm run build`, start `npm start`, set `JWT_SECRET` and `MANGADEX_UA`.
4. First visitor registers → becomes Super Admin.

Generic hosts (Railway/Fly/cPanel): same commands; SQLite lives at `DB_PATH` (use a persistent disk on free tiers, or accept data resets on ephemeral storage).

---

## API summary

| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/auth/register` | public (first user → super_admin) |
| POST | `/api/auth/login` · `/logout` · GET `/me` | public |
| GET | `/api/manga`, `/api/manga/:id` | public |
| GET | `/api/novels`, `/api/novels/:id`, `/api/novels/sources`, `/api/novels/search` | public |
| GET | `/api/anime/search?q=`, `/api/anime/:id` | public — AniList GraphQL (title, description, trailer, score, episodes) |
| GET | `/api/reader/manga/:mangaId/chapters/:chapterId/pages` | public (download counted) |
| GET | `/api/reader/chapter/:id` | public — resolves + returns hash & full page filenames (atHome) |
| GET | `/api/reader/novels/:novelId/chapters/:index` | public (download counted) |
| GET | `/api/reader/image/:chapterId/:index` | public (rate-limited, proxied) |
| GET/POST | `/api/reader/downloads/status·reward·redeem` | auth for reward/redeem |
| GET/POST | `/api/comments` · PATCH/DELETE `/:id` | auth / owner·staff |
| GET/POST/DELETE | `/api/user/bookmarks` · `/history` | auth |
| GET | `/api/ads` | public |
| GET/PATCH | `/api/admin/users` · `/:id/role` | super_admin |
| GET/PUT/POST/DELETE | `/api/admin/ads` · `/api/admin/settings` | super_admin |
| POST | `/api/admin/sync` · GET `/status` | super_admin |
| POST | `/api/admin/novels/import` | super_admin |

All non-GET endpoints require the `X-CSRF-Token` header (handled automatically by the client).
