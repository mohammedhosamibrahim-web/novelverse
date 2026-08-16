import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../api';
import AdSlot from './AdSlot';

/**
 * The rewarded-ad "download wall".
 * Shown when the daily download limit (11 chapters) is reached:
 * 1. renders the admin-configured download_wall ad slot
 * 2. user watches/completes the ad, then taps "Unlock +5"
 * 3. backend issues a grant token → redeem → extra downloads for 24h
 *
 * Real ad networks (AdSterra / AdSense rewarded) should call onAdComplete()
 * from their SDK callback instead of the demo button.
 */
export default function DownloadWall({ onUnlocked }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [phase, setPhase] = useState('ad'); // ad → watching → unlocking
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(5);
  const [token, setToken] = useState(null);

  useEffect(() => {
    api('/reader/downloads/status').then((d) => setStatus(d.download)).catch(() => {});
  }, []);

  // simulated ad completion: 5s countdown, then unlock
  useEffect(() => {
    if (phase !== 'watching') return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          unlock();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const startWatching = async () => {
    if (!user) return;
    setError('');
    try {
      const { token: grantToken } = await api('/reader/downloads/reward', { method: 'POST', body: {} });
      setToken(grantToken);
      setPhase('watching');
      setCountdown(5);
    } catch (err) {
      setError(err.data && err.data.code === 'AD_SLOT_DISABLED' ? t('wall.notConfigured') : err.message);
    }
  };

  const unlock = async () => {
    try {
      const { download } = await api('/reader/downloads/redeem', { method: 'POST', body: { token } });
      setStatus(download);
      setPhase('unlocking');
      setTimeout(() => onUnlocked(download), 600);
    } catch (err) {
      setError(err.message);
      setPhase('ad');
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
        <h2 className="text-lg font-bold text-white">{t('wall.title')}</h2>
        <p className="mt-2 text-sm text-slate-400">
          {t('wall.subtitleLogin', { limit: status ? status.limit : 11 })}{' '}
          <Link to="/login" className="text-accent-soft underline">
            {t('wall.loginCta')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-surface-border bg-surface-card p-6 text-center">
      <h2 className="text-lg font-bold text-white">{t('wall.title')}</h2>
      {status && (
        <p className="mt-1 text-xs text-slate-500">
          {t('wall.usedToday', { used: status.used, total: status.limit + status.bonus })}
          {status.bonus > 0 ? ` ${t('wall.bonusNote', { n: status.bonus })}` : ''}
        </p>
      )}

      {phase === 'ad' && (
        <>
          <div className="mt-4 rounded-lg border border-surface-border bg-surface-soft p-3">
            <AdSlot slotKey="download_wall" />
          </div>
          <button className="btn-primary mt-4 w-full" onClick={startWatching}>
            {t('wall.watchAd')}
          </button>
        </>
      )}

      {phase === 'watching' && (
        <div className="mt-4 rounded-lg border border-surface-border bg-surface-soft p-6">
          <p className="text-sm text-slate-300">
            {t('wall.adPlaying', { s: countdown })}
          </p>
          <p className="mt-2 text-xs text-slate-500">{t('wall.adNote')}</p>
        </div>
      )}

      {phase === 'unlocking' && <p className="mt-4 text-sm font-semibold text-emerald-400">{t('wall.unlocked')}</p>}
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
    </div>
  );
}
