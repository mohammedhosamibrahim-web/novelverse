import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { usePwaInstall } from '../pwa';
import { api } from '../api';
import AdSlot from './AdSlot';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useI18n();
  const { canInstall, install } = usePwaInstall();
  const navigate = useNavigate();
  const [ads, setAds] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api('/ads')
      .then(({ slots }) => {
        const map = {};
        for (const s of slots) map[s.key] = s;
        setAds(map);
      })
      .catch(() => {});
  }, [user]);

  const headerAd = useMemo(() => (ads.header ? ads.header.html : ''), [ads]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40">
      {headerAd && <AdSlot html={headerAd} className="ad-slot header-slot bg-black/40" />}
      <nav className="border-b border-surface-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="text-lg font-black tracking-tight text-white">
            Novel<span className="text-accent-soft">Verse</span>
          </Link>

          <div className="hidden items-center gap-1 sm:flex">
            <Link to="/" className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-surface-card hover:text-white">
              {t('nav.home')}
            </Link>
            <Link to="/browse" className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-surface-card hover:text-white">
              {t('nav.browse')}
            </Link>
            {user && user.role === 'super_admin' && (
              <Link to="/admin" className="rounded-md px-3 py-1.5 text-sm text-accent-soft hover:bg-surface-card hover:text-white">
                {t('nav.admin')}
              </Link>
            )}
          </div>

          <div className="ms-auto flex items-center gap-2">
            {/* Permanent install button (works even if the banner was dismissed) */}
            {canInstall && (
              <button onClick={install} className="btn-primary !py-1.5 text-xs" title={t('pwa.install')}>
                ⬇ {t('nav.install')}
              </button>
            )}
            {/* Language switcher */}
            <div className="flex overflow-hidden rounded-lg border border-surface-border text-xs">
              {[
                ['en', 'EN'],
                ['ar', 'عربي'],
              ].map(([code, label]) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  className={`px-2.5 py-1.5 font-semibold transition ${
                    lang === code ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {user ? (
              <>
                <Link to="/profile" className="hidden rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-surface-card hover:text-white sm:block">
                  {user.username}
                  <span className="ms-1.5 rounded bg-surface-card px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {user.role === 'super_admin' ? 'admin' : user.role}
                  </span>
                </Link>
                <button onClick={handleLogout} className="btn-ghost !py-1.5">
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn-ghost !py-1.5">
                  {t('nav.login')}
                </Link>
                <Link to="/register" className="btn-primary !py-1.5">
                  {t('nav.register')}
                </Link>
              </>
            )}
            <button className="rounded-md p-2 text-slate-300 sm:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-surface-border bg-surface px-4 py-2 sm:hidden">
            <Link to="/" className="block py-2 text-sm text-slate-300" onClick={() => setMenuOpen(false)}>
              {t('nav.home')}
            </Link>
            <Link to="/browse" className="block py-2 text-sm text-slate-300" onClick={() => setMenuOpen(false)}>
              {t('nav.browse')}
            </Link>
            {user && user.role === 'super_admin' && (
              <Link to="/admin" className="block py-2 text-sm text-accent-soft" onClick={() => setMenuOpen(false)}>
                {t('nav.admin')}
              </Link>
            )}
            {user ? (
              <Link to="/profile" className="block py-2 text-sm text-slate-300" onClick={() => setMenuOpen(false)}>
                {user.username}
              </Link>
            ) : (
              <Link to="/login" className="block py-2 text-sm text-slate-300" onClick={() => setMenuOpen(false)}>
                {t('nav.login')}
              </Link>
            )}
            {canInstall && (
              <button className="block py-2 text-sm text-accent-soft" onClick={install}>
                ⬇ {t('nav.install')}
              </button>
            )}
          </div>
        )}
      </nav>
    </header>
  );
}
