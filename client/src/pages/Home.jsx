import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import MangaCard from '../components/MangaCard';

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [manga, setManga] = useState([]);
  const [novels, setNovels] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api('/manga?limit=12').then((d) => setManga(d.items)).catch(() => {});
    api('/novels?limit=12').then((d) => setNovels(d.items)).catch(() => {});
    if (user) api('/user/history').then((d) => setHistory(d.items)).catch(() => {});
  }, [user]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Hero */}
      <section className="mb-10 rounded-3xl border border-surface-border bg-gradient-to-br from-surface-card via-surface to-surface p-8 sm:p-12">
        <h1 className="max-w-xl text-3xl font-black leading-tight text-white sm:text-5xl">{t('home.heroTitle')}</h1>
        <p className="mt-3 max-w-lg text-sm text-slate-400 sm:text-base">{t('home.heroSubtitle')}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/browse" className="btn-primary">
            {t('home.startReading')}
          </Link>
          <Link to="/register" className="btn-ghost">
            {t('home.createAccount')}
          </Link>
        </div>
      </section>

      {/* Continue reading */}
      {user && history.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-bold text-white">{t('home.continueReading')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {history.slice(0, 4).map((h) => {
              const isManga = h.target_type === 'manga';
              const href = isManga
                ? `/reader/manga/${h.target_id}/${h.chapter_id}`
                : h.chapter_id
                  ? `/reader/novel/${h.target_id}/${h.chapter_id}`
                  : isManga
                    ? `/manga/${h.target_id}`
                    : `/novel/${h.target_id}`;
              return (
                <Link key={h.id} to={href} className="rounded-xl border border-surface-border bg-surface-card p-4 transition hover:border-accent/60">
                  <p className="text-sm font-semibold text-slate-200">
                    {isManga ? t('prof.manga') : t('prof.novel')} #{h.target_id}
                  </p>
                  <div className="mt-1 h-1.5 rounded bg-surface-soft">
                    <div className="h-full rounded bg-accent" style={{ width: `${Math.round((h.progress || 0) * 100)}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">{t('home.progressRead', { n: Math.round((h.progress || 0) * 100) })}</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Latest manga */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">{t('home.latestManga')}</h2>
          <Link to="/browse?type=manga" className="text-sm text-accent-soft hover:underline">
            {t('home.seeAll')}
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {manga.map((m) => (
            <MangaCard key={m.id} item={m} type="manga" />
          ))}
        </div>
      </section>

      {/* Latest novels */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">{t('home.latestNovels')}</h2>
          <Link to="/browse?type=novel" className="text-sm text-accent-soft hover:underline">
            {t('home.seeAll')}
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {novels.map((n) => (
            <MangaCard key={n.id} item={n} type="novel" />
          ))}
        </div>
      </section>
    </div>
  );
}
