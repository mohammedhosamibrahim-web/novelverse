import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { listChapters, removeChapter, clearChapters } from '../offline';

export default function Profile() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [history, setHistory] = useState([]);
  const [download, setDownload] = useState(null);
  const [offline, setOffline] = useState([]);

  const loadOffline = async () => {
    try {
      setOffline(await listChapters());
    } catch {
      setOffline([]);
    }
  };

  useEffect(() => {
    api('/user/profile').then(setProfile).catch(() => {});
    api('/user/bookmarks').then((d) => setBookmarks(d.items)).catch(() => {});
    api('/user/history').then((d) => setHistory(d.items)).catch(() => {});
    api('/reader/downloads/status').then((d) => setDownload(d.download)).catch(() => {});
    loadOffline();
  }, []);

  const removeBookmark = async (type, id) => {
    await api(`/user/bookmarks?target_type=${type}&target_id=${id}`, { method: 'DELETE' });
    setBookmarks((b) => b.filter((x) => !(x.target_type === type && x.target_id === id)));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-white">{t('prof.title')}</h1>
        <button className="btn-ghost" onClick={handleLogout}>
          {t('nav.logout')}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">{t('prof.account')}</p>
          <p className="mt-1 text-lg font-bold text-white">{profile?.user?.username || user?.username}</p>
          <p className="truncate text-sm text-slate-400">{profile?.user?.email || user?.email}</p>
          <span className="mt-2 inline-block rounded bg-surface-soft px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            {profile?.user?.role || user?.role}
          </span>
          <div className="mt-4 space-y-1 text-xs text-slate-500">
            <p>{t('prof.bookmarks')}: {profile?.counts?.bookmarkCount ?? bookmarks.length}</p>
            <p>{t('prof.history')}: {profile?.counts?.historyCount ?? history.length}</p>
            <p>{t('prof.comments')}: {profile?.counts?.commentCount ?? 0}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">{t('prof.dailyDownloads')}</p>
          {download ? (
            <>
              <p className="mt-1 text-3xl font-black text-white">
                {download.remaining}
                <span className="text-base font-normal text-slate-500"> {t('prof.remainingWord')}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {t('prof.usedOf', { used: download.used, total: download.limit + download.bonus })}
                {download.bonus > 0 && ` ${t('prof.bonusNote', { n: download.bonus })}`}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded bg-surface-soft">
                <div
                  className={`h-full rounded ${download.requiresAd ? 'bg-rose-500' : 'bg-accent'}`}
                  style={{ width: `${Math.min(100, (download.used / Math.max(1, download.limit + download.bonus)) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">{t('prof.resets')}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">{t('common.loading')}</p>
          )}
        </div>

        <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">{t('prof.pwaTitle')}</p>
          <p className="mt-2 text-sm text-slate-400">{t('prof.pwaText')}</p>
          <button
            className="btn-primary mt-3 w-full"
            onClick={() => window.open('https://support.google.com/chrome/answer/9658361', '_blank')}
          >
            {t('prof.howToInstall')}
          </button>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-bold text-white">{t('prof.bookmarks')}</h2>
      {bookmarks.length === 0 ? (
        <p className="text-sm text-slate-500">{t('prof.noBookmarks')}</p>
      ) : (
        <ul className="space-y-2">
          {bookmarks.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-card px-4 py-3">
              <Link
                to={b.target_type === 'manga' ? `/manga/${b.target_id}` : `/novel/${b.target_id}`}
                className="text-sm font-semibold text-slate-200 hover:text-white"
              >
                {t('prof.itemTitle', { type: b.target_type === 'manga' ? t('prof.manga') : t('prof.novel'), id: b.target_id })}
              </Link>
              <button className="text-xs text-slate-500 hover:text-rose-400" onClick={() => removeBookmark(b.target_type, b.target_id)}>
                {t('prof.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 mt-8 text-xl font-bold text-white">{t('prof.downloads')}</h2>
      {offline.length === 0 ? (
        <p className="text-sm text-slate-500">{t('prof.noDownloads')}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {offline.map((o) => (
              <li key={o.key} className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-card px-4 py-3">
                <div className="min-w-0">
                  <Link
                    to={o.type === 'manga' ? `/reader/manga/${o.mangaId}/${o.chapterId}` : `/reader/novel/${o.novelId}/${o.index}`}
                    className="block truncate text-sm font-semibold text-slate-200 hover:text-white"
                  >
                    {t('prof.downloadedType', {
                      type: o.type === 'manga' ? t('prof.manga') : t('prof.novel'),
                      id: o.type === 'manga' ? o.chapterId : o.index,
                      title: o.title || '',
                    })}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-slate-500">{t('prof.savedAt', { d: new Date(o.savedAt).toLocaleString() })}</p>
                </div>
                <button
                  className="text-xs text-slate-500 hover:text-rose-400"
                  onClick={async () => {
                    await removeChapter(o.key);
                    loadOffline();
                  }}
                >
                  {t('prof.remove')}
                </button>
              </li>
            ))}
          </ul>
          <button
            className="btn-ghost mt-3"
            onClick={async () => {
              if (window.confirm(t('comments.confirmDelete'))) {
                await clearChapters();
                loadOffline();
              }
            }}
          >
            {t('prof.removeAll')}
          </button>
        </>
      )}

      <h2 className="mb-3 mt-8 text-xl font-bold text-white">{t('prof.readingHistory')}</h2>
      {history.length === 0 ? (
        <p className="text-sm text-slate-500">{t('prof.noHistory')}</p>
      ) : (
        <ul className="space-y-2">
          {history.map((h) => {
            const isManga = h.target_type === 'manga';
            const href = isManga && h.chapter_id
              ? `/reader/manga/${h.target_id}/${h.chapter_id}`
              : h.chapter_id
                ? `/reader/novel/${h.target_id}/${h.chapter_id}`
                : isManga
                  ? `/manga/${h.target_id}`
                  : `/novel/${h.target_id}`;
            return (
              <li key={h.id} className="rounded-xl border border-surface-border bg-surface-card px-4 py-3">
                <Link to={href} className="text-sm font-semibold text-slate-200 hover:text-white">
                  {t('prof.itemTitle', { type: isManga ? t('prof.manga') : t('prof.novel'), id: h.target_id })}
                </Link>
                <div className="mt-1.5 h-1.5 rounded bg-surface-soft">
                  <div className="h-full rounded bg-accent" style={{ width: `${Math.round((h.progress || 0) * 100)}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{t('prof.percentRead', { n: Math.round((h.progress || 0) * 100), d: h.updated_at })}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
