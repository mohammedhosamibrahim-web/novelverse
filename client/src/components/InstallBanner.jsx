import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { capturePrompt, promptInstall, isStandalone } from '../pwa';

/**
 * PWA auto-install prompt banner.
 * Captures the browser's `beforeinstallprompt` event (shared via pwa.js so
 * the navbar's permanent Install button works too), shows this banner
 * automatically a few seconds after the visitor arrives, and triggers the
 * native install flow on click. Respects the user's dismissal and hides
 * once the app is installed (standalone mode).
 */
export default function InstallBanner() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return undefined;
    }
    const onPrompt = (e) => {
      capturePrompt(e);
      if (localStorage.getItem('pwa-install-dismissed') !== '1') {
        setTimeout(() => setVisible(true), 3000);
      }
    };
    const onInstalled = () => {
      setVisible(false);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    await promptInstall();
    setVisible(false);
  };

  const dismiss = () => {
    localStorage.setItem('pwa-install-dismissed', '1');
    setVisible(false);
  };

  if (installed || !visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-surface-border bg-surface-card p-4 shadow-2xl">
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">{t('pwa.bannerTitle')}</p>
        <p className="mt-0.5 text-xs text-slate-400">{t('pwa.bannerDesc')}</p>
      </div>
      <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={install}>
        {t('pwa.install')}
      </button>
      <button className="text-xs text-slate-500 hover:text-white" onClick={dismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
