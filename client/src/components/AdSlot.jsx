import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Renders an ad slot's HTML (admin-managed). Accepts either a slot key
 * (fetches the ad list) or pre-fetched html.
 */
export default function AdSlot({ slotKey, html, className = '' }) {
  const [ad, setAd] = useState(html || '');

  useEffect(() => {
    if (html) return;
    if (!slotKey) return;
    let cancelled = false;
    api('/ads')
      .then(({ slots }) => {
        if (cancelled) return;
        const slot = slots.find((s) => s.key === slotKey);
        if (slot) setAd(slot.html);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slotKey, html]);

  if (!ad) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: ad }} />;
}
