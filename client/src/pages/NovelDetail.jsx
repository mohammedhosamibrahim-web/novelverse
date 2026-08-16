import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import CommentSection from '../components/CommentSection';

export default function NovelDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [novel, setNovel] = useState(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/novels/${id}`).then(setNovel).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!user) return;
    api('/user/bookmarks')
      .then(({ items }) => setBookmarked(items.some((b) => b.target_type === 'novel' && b.target_id === String(id))))
      .catch(() => {});
  }, [user, id]);

  if (error) return <div className="px-4 py-16 text-center text-rose-400">{error}</div>;
  if (!novel) return <div className="px-4 py-24 text-center text-sm text-slate-500">{t('common.loading')}</div>;

  const cover = novel.cover_url ? `/api/proxy/image?url=${encodeURIComponent(novel.cover_url)}` : null;

  const toggleBookmark = async () => {
    if (!user) return;
    try {
      if (bookmarked) {
        await api(`/user/bookmarks?target_type=novel&target_id=${id}`, { method: 'DELETE' });
      } else {
        await api('/user/bookmarks', { method: 'POST', body: { target_type: 'novel', target_id: id } });
      }
      setBookmarked(!bookmarked);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        {cover && <img src={cover} alt={novel.title} className="h-72 w-48 shrink-0 rounded-xl border border-surface-border object-cover" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black text-white sm:text-3xl">{novel.title}</h1>
          {novel.author && <p className="mt-1 text-sm text-slate-400">{t('manga.by', { author: novel.author })}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-surface-card px-2 py-1 text-slate-400">{t('novel.source', { s: novel.source })}</span>
            <span className="rounded bg-surface-card px-2 py-1 text-slate-400">{t('manga.chaptersLabel', { n: novel.chapters?.length || 0 })}</span>
          </div>
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

      <h2 className="mb-3 mt-10 text-xl font-bold text-white">{t('novel.toc')}</h2>
      {novel.chapters.length === 0 ? (
        <p className="text-sm text-slate-500">{t('novel.noChapters')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {novel.chapters.map((ch) => (
            <Link
              key={ch.id}
              to={`/reader/novel/${novel.id}/${ch.chapter_index}`}
              className="truncate rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm text-slate-300 transition hover:border-accent/60 hover:text-white"
            >
              {ch.title || `#${ch.chapter_index}`}
              {ch.fetched_at && <span className="ms-1.5 text-[10px] text-emerald-500">{t('novel.cached')}</span>}
            </Link>
          ))}
        </div>
      )}

      <CommentSection targetType="novel" targetId={String(id)} />
    </div>
  );
}
