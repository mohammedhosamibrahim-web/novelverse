import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import CommentSection from '../components/CommentSection';

export default function MangaDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [manga, setManga] = useState(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [error, setError] = useState('');
  const [langFilter, setLangFilter] = useState('all'); // all | en | ar

  useEffect(() => {
    api(`/manga/${id}`).then(setManga).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!user) return;
    api('/user/bookmarks')
      .then(({ items }) => setBookmarked(items.some((b) => b.target_type === 'manga' && b.target_id === String(id))))
      .catch(() => {});
  }, [user, id]);

  if (error) return <div className="px-4 py-16 text-center text-rose-400">{error}</div>;
  if (!manga) return <div className="px-4 py-24 text-center text-sm text-slate-500">{t('common.loading')}</div>;

  const cover = manga.cover_url ? `/api/proxy/image?url=${encodeURIComponent(manga.cover_url)}` : null;

  const toggleBookmark = async () => {
    if (!user) return;
    try {
      if (bookmarked) {
        await api(`/user/bookmarks?target_type=manga&target_id=${id}`, { method: 'DELETE' });
      } else {
        await api('/user/bookmarks', { method: 'POST', body: { target_type: 'manga', target_id: id } });
      }
      setBookmarked(!bookmarked);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        {cover && (
          <img src={cover} alt={manga.title} className="h-72 w-48 shrink-0 rounded-xl border border-surface-border object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black text-white sm:text-3xl">{manga.title}</h1>
          {manga.author && <p className="mt-1 text-sm text-slate-400">{t('manga.by', { author: manga.author })}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {manga.score != null && <span className="rounded bg-emerald-600/80 px-2 py-1 font-bold text-white">{manga.score}%</span>}
            {manga.status && <span className="rounded bg-surface-card px-2 py-1 text-slate-400">{manga.status}</span>}
            {manga.year && <span className="rounded bg-surface-card px-2 py-1 text-slate-400">{manga.year}</span>}
            <span className="rounded bg-surface-card px-2 py-1 text-slate-400">{t('manga.chaptersLabel', { n: manga.chapters?.length || 0 })}</span>
          </div>
          {manga.provider === 'anilist' && (
            <p className="mt-2 text-xs text-accent-soft">{t('manga.anilistNote')}</p>
          )}
          {manga.description && <p className="mt-4 line-clamp-4 max-w-3xl text-sm leading-relaxed text-slate-400">{manga.description}</p>}
          <div className="mt-5">
            {user ? (
              <button onClick={toggleBookmark} className={bookmarked ? 'btn-primary' : 'btn-ghost'}>
                {bookmarked ? t('manga.bookmarked') : t('manga.bookmark')}
              </button>
            ) : (
              <Link to="/login" className="btn-ghost">
                {t('manga.loginBookmark')}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mb-3 mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">{t('manga.chapterTitle')}</h2>
        {/* chapter language switcher: All / English / العربية */}
        <div className="flex overflow-hidden rounded-lg border border-surface-border text-xs">
          {[
            ['all', t('manga.langAll')],
            ['en', t('manga.langEn')],
            ['ar', t('manga.langAr')],
          ].map(([lang, label]) => (
            <button
              key={lang}
              onClick={() => setLangFilter(lang)}
              className={`px-3 py-1.5 font-semibold ${
                langFilter === lang ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {(() => {
        const chapters = langFilter === 'all' ? manga.chapters : manga.chapters.filter((c) => c.lang === langFilter);
        return chapters.length === 0 ? (
          <p className="text-sm text-slate-500">
            {manga.chapters.length === 0 ? t('manga.noChapters') : t('browse.results', { n: 0 })}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {chapters.map((ch) => (
              <Link
                key={ch.id}
                to={`/reader/manga/${manga.id}/${ch.id}`}
                className="truncate rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-slate-300 transition hover:border-accent/60 hover:text-white"
              >
                {ch.chapter_number !== null && ch.chapter_number !== 0 ? t('manga.chapterNum', { n: ch.chapter_number }) : ch.title || `#${ch.id}`}
                {ch.title && <span className="ms-1 text-xs text-slate-500">· {ch.title}</span>}
                <span
                  className={`ms-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                    ch.lang === 'ar' ? 'bg-amber-500/20 text-amber-400' : 'bg-surface-soft text-slate-500'
                  }`}
                >
                  {ch.lang === 'ar' ? t('manga.langAr') : ch.lang === 'en' ? 'EN' : ch.lang}
                </span>
              </Link>
            ))}
          </div>
        );
      })()}

      <CommentSection targetType="manga" targetId={String(id)} />
    </div>
  );
}
