import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import AdSlot from './AdSlot';

export default function Footer() {
  const { t } = useI18n();
  const [footerAd, setFooterAd] = useState('');
  useEffect(() => {
    api('/ads').then(({ slots }) => {
      const s = slots.find((x) => x.key === 'footer');
      if (s) setFooterAd(s.html);
    }).catch(() => {});
  }, []);

  return (
    <footer className="mt-12 border-t border-surface-border bg-surface">
      {footerAd && <AdSlot html={footerAd} className="ad-slot mx-auto max-w-6xl px-4 py-3" />}
      <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-500">
        <p>{t('footer.tagline')}</p>
        <p className="mt-1">{t('footer.installHint')}</p>
      </div>
    </footer>
  );
}
