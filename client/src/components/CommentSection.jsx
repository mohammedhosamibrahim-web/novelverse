import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../api';

/**
 * Chapter-level comment section with spoiler tags.
 * target_type: manga | novel | manga_chapter | novel_chapter
 */
export default function CommentSection({ targetType, targetId }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [content, setContent] = useState('');
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const load = async (p = 1) => {
    try {
      const data = await api(`/comments?target_type=${targetType}&target_id=${targetId}&page=${p}`);
      setItems(data.items);
      setPages(data.pages);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetId]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!user) {
      setError(t('comments.loginRequired'));
      return;
    }
    try {
      await api('/comments', { method: 'POST', body: { target_type: targetType, target_id: targetId, content, is_spoiler: isSpoiler } });
      setContent('');
      setIsSpoiler(false);
      load(1);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    if (!window.confirm(t('comments.confirmDelete'))) return;
    try {
      await api(`/comments/${id}`, { method: 'DELETE' });
      load(page);
    } catch {
      /* ignore */
    }
  };

  const canModerate = user && ['super_admin', 'moderator'].includes(user.role);

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold text-white">{t('comments.title', { n: items.length })}</h2>

      <form onSubmit={submit} className="mb-6 rounded-xl border border-surface-border bg-surface-card p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={user ? t('comments.placeholder') : t('comments.loginToComment')}
          rows={3}
          className="input-field resize-y"
          disabled={!user}
        />
        <div className="mt-2 flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={isSpoiler} onChange={(e) => setIsSpoiler(e.target.checked)} className="accent-indigo-500" />
            {t('comments.spoiler')}
          </label>
          <button className="btn-primary ms-auto" disabled={!content.trim()}>
            {t('comments.post')}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      </form>

      <ul className="space-y-3">
        {items.map((c) => (
          <li key={c.id} className="rounded-xl border border-surface-border bg-surface-card p-4">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-300">{c.username}</span>
              <span className="text-slate-600">{c.created_at}</span>
              {!!c.is_spoiler && (
                <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-400">{t('comments.spoiler')}</span>
              )}
              {(user && (user.id === c.user_id || canModerate)) && (
                <button onClick={() => remove(c.id)} className="ms-auto text-slate-500 hover:text-rose-400">
                  {t('comments.delete')}
                </button>
              )}
            </div>
            {!!c.is_spoiler ? <SpoilerText html={c.content} label={t('comments.spoilerReveal')} /> : <p className="text-sm leading-relaxed text-slate-300" dangerouslySetInnerHTML={{ __html: c.content }} />}
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => { setPage(page - 1); load(page - 1); }}>
            {t('comments.prev')}
          </button>
          <span className="text-sm text-slate-400">
            {page} / {pages}
          </span>
          <button className="btn-ghost" disabled={page >= pages} onClick={() => { setPage(page + 1); load(page + 1); }}>
            {t('comments.next')}
          </button>
        </div>
      )}
    </section>
  );
}

/** Spoiler content stays blurred until clicked. */
function SpoilerText({ html, label }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return <p className="text-sm leading-relaxed text-slate-300" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div
      onClick={() => setRevealed(true)}
      className="spoiler-hidden rounded bg-surface-soft p-3 text-sm text-slate-300"
      title={label}
    >
      <span className="me-2 text-xs uppercase tracking-wide text-rose-400">{label}</span>
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
