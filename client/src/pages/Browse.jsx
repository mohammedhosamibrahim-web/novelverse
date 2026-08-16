import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import MangaCard from '../components/MangaCard';
import AdSlot from '../components/AdSlot';

const TYPES = ['manga', 'novel', 'anime'];

export default function Browse() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const rawType = params.get('type');
  const type = TYPES.includes(rawType) ? rawType : 'manga';
  const initialQ = params.get('q') || '';
  const [q, setQ] = useState(initialQ);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const path = type === 'manga' ? '/manga' : type === 'novel' ? '/novels' : '/anime/search';
    api(`${path}?q=${encodeURIComponent(q)}&page=${page}&limit=24`)
      .then((d) => {
        if (cancelled) return;
        setItems(d.items);
        setTotal(d.total);
        setPages(d.pages || Math.max(1, Math.ceil((d.total || 0) / 24)));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, q, page]);

  const switchType = (newType) => {
    setParams(newType === 'manga' ? {} : { type: newType });
    setPage(1);
  };

  const onSearch = (e) => {
    e.preventDefault();
    setPage(1);
  };

  const placeholder =
    type === 'manga' ? t('browse.searchManga') : type === 'novel' ? t('browse.searchNovels') : t('browse.searchAnime');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-xl border border-surface-border bg-surface-card p-1">
          {[
            ['manga', t('browse.mangaTab')],
            ['novel', t('browse.novelTab')],
            ['anime', t('browse.animeTab')],
          ].map(([tabType, label]) => (
            <button
              key={tabType}
              onClick={() => switchType(tabType)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${type === tabType ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={onSearch} className="flex max-w-sm flex-1 gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="input-field"
          />
          <button className="btn-primary" type="submit">
            {t('browse.search')}
          </button>
        </form>
      </div>

      <p className="mb-4 text-xs text-slate-500">
        {t('browse.results', { n: total })}
        {type === 'anime' && ' — AniList (trailer + description)'}
        {type === 'novel' && t('browse.novelNote')}
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          {loading ? (
            <div className="py-24 text-center text-sm text-slate-500">{t('common.loading')}</div>
          ) : items.length === 0 ? (
            <div className="py-24 text-center text-sm text-slate-500">
              {type === 'manga' ? t('browse.emptyManga') : type === 'novel' ? t('browse.emptyNovel') : t('browse.emptyNovel')}
            </div>
          ) : type === 'anime' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => (
                <AnimeCard key={a.id} item={a} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
              {items.map((it) => (
                <MangaCard key={it.id} item={it} type={type} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('browse.prev')}
              </button>
              <span className="text-sm text-slate-400">{t('browse.page', { page, pages })}</span>
              <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                {t('browse.next')}
              </button>
            </div>
          )}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <AdSlot slotKey="sidebar" />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Anime card: AniList metadata + trailer (YouTube). */
function AnimeCard({ item }) {
  const { t } = useI18n();
  const cover = item.cover ? `/api/proxy/image?url=${encodeURIComponent(item.cover)}` : null;
  return (
    <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-card transition hover:border-accent/60">
      <div className="relative aspect-video w-full overflow-hidden bg-surface-soft">
        {cover ? (
          <img src={cover} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-slate-500">{item.title}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-2 text-[11px]">
          {item.score != null && <span className="rounded bg-emerald-500/80 px-1.5 py-0.5 font-bold text-white">{t('anime.score', { n: item.score })}</span>}
          {item.episodes && <span className="rounded bg-black/60 px-1.5 py-0.5 text-slate-200">{t('anime.episodes', { n: item.episodes })}</span>}
        </div>
      </div>
      <div className="p-3">
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-200">{item.title}</h3>
        {item.description && <p className="line-clamp-3 mt-1 text-xs leading-relaxed text-slate-400">{item.description}</p>}
        {item.trailer && item.trailer.youtubeId && (
          <a
            href={`https://www.youtube.com/watch?v=${item.trailer.youtubeId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost mt-2 !px-2 !py-1 text-xs"
          >
            {t('anime.trailer')}
          </a>
        )}
      </div>
    </div>
  );
}
