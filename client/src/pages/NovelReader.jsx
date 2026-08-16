import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { saveChapter, getChapter } from '../offline';
import AdSlot from '../components/AdSlot';
import CommentSection from '../components/CommentSection';
import DownloadWall from '../components/DownloadWall';

export default function NovelReader() {
  const { novelId, index } = useParams();
  const { user } = useAuth();
  const { lang, t } = useI18n();
  const [chapter, setChapter] = useState(null);
  const [content, setContent] = useState('');
  const [ads, setAds] = useState({});
  const [limitReached, setLimitReached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('novel-theme') || 'dark');
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('novel-font') || '18', 10));
  const [download, setDownload] = useState(null);
  const [dlStatus, setDlStatus] = useState('idle');
  const [offlineCopy, setOfflineCopy] = useState(null);
  const progressTimer = useRef(null);
  const scrollRef = useRef(null);

  const loadAds = useCallback(() => {
    api('/ads').then(({ slots }) => {
      const map = {};
      for (const s of slots) map[s.key] = s;
      setAds(map);
    }).catch(() => {});
  }, []);

  const loadChapter = useCallback(async () => {
    setLoading(true);
    setLimitReached(false);
    try {
      const data = await api(`/reader/novels/${novelId}/chapters/${index}`);
      setChapter(data.chapter);
      setContent(data.content);
      setDownload(data.download);
    } catch (err) {
      if (err.status === 429 && err.data && err.data.requiredAd) {
        setLimitReached(true);
      } else {
        // network failure → fall back to the saved offline copy
        // (key derives from the URL so it works even on the very first load)
        try {
          const copy = await getChapter(`novel:${novelId}:${index}`);
          if (copy && copy.content) {
            setOfflineCopy(copy);
            setContent(copy.content);
            setChapter({ id: copy.chapterId, index: copy.index, title: copy.title });
          } else {
            console.error(err);
          }
        } catch {
          console.error(err);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [novelId, index]);

  const saveOffline = async () => {
    setDlStatus('saving');
    try {
      await saveChapter(`novel:${novelId}:${index}`, {
        type: 'novel',
        novelId,
        chapterId: chapter ? chapter.id : null,
        index,
        title: chapter ? chapter.title : '',
        content,
        savedAt: new Date().toISOString(),
      });
      setDlStatus('done');
    } catch {
      setDlStatus('error');
    }
  };

  useEffect(() => {
    loadChapter();
    loadAds();
  }, [loadChapter, loadAds]);

  const setThemeAndStore = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('novel-theme', newTheme);
  };
  const setFontAndStore = (f) => {
    setFontSize(f);
    localStorage.setItem('novel-font', String(f));
  };

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      if (user) {
        api('/user/history', {
          method: 'POST',
          body: { target_type: 'novel', target_id: novelId, chapter_id: chapter ? chapter.id : index, progress },
        }).catch(() => {});
      }
    }, 500);
  }, [user, novelId, index, chapter]);

  // Inject in-reader ad blocks after every N paragraphs.
  const renderedContent = useMemo(() => {
    if (!content || !ads.in_reader?.html) return content;
    const every = Math.max(1, parseInt(ads.in_reader.position?.every || 8, 10));
    try {
      const doc = new DOMParser().parseFromString(`<div id="novel-root">${content}</div>`, 'text/html');
      const root = doc.getElementById('novel-root');
      const paras = root.querySelectorAll('p');
      let count = 0;
      for (const p of paras) {
        count += 1;
        if (count % every === 0) {
          const ad = doc.createElement('div');
          ad.className = 'ad-slot my-6';
          ad.innerHTML = ads.in_reader.html;
          p.after(ad);
        }
      }
      return root.innerHTML;
    } catch {
      return content;
    }
  }, [content, ads]);

  if (loading) return <div className="px-4 py-24 text-center text-sm text-slate-500">{t('reader.loading')}</div>;

  return (
    <div ref={scrollRef} onScroll={onScroll} className={`reader reader-theme-${theme} min-h-screen pb-16`}>
      {/* top bar */}
      <div className="sticky top-14 z-30 border-b border-surface-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-2.5">
          <Link to={`/novel/${novelId}`} className="btn-ghost !px-3 !py-1.5 text-xs">
            {t('reader.toc')}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{chapter ? chapter.title || `#${chapter.index}` : ''}</p>
            {download && (
              <p className="text-[10px] text-slate-500">{t('reader.today', { used: download.used, total: download.limit + download.bonus })}</p>
            )}
          </div>
          {/* theme switcher */}
          <div className="flex overflow-hidden rounded-lg border border-surface-border">
            {[
              ['dark', t('reader.themeDark')],
              ['sepia', t('reader.themeSepia')],
              ['light', t('reader.themeLight')],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setThemeAndStore(id)}
                className={`px-2.5 py-1.5 text-xs ${theme === id ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* font size */}
          <div className="flex items-center gap-1.5 rounded-lg border border-surface-border px-2 py-1">
            <button className="px-1.5 text-sm font-bold text-slate-400 hover:text-white" onClick={() => setFontAndStore(Math.max(14, fontSize - 2))}>
              A−
            </button>
            <span className="w-8 text-center text-xs text-slate-400">{fontSize}px</span>
            <button className="px-1.5 text-sm font-bold text-slate-400 hover:text-white" onClick={() => setFontAndStore(Math.min(28, fontSize + 2))}>
              A+
            </button>
          </div>
          {content && !limitReached && (
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={saveOffline} disabled={dlStatus === 'saving'} title={t('reader.download')}>
              {dlStatus === 'saving' ? t('reader.downloading', { n: 1, total: 1 }) : dlStatus === 'done' ? t('reader.downloaded') : '⬇'}
            </button>
          )}
        </div>
      </div>

      {offlineCopy && (
        <div className="mx-auto max-w-3xl px-4 pt-3 text-center text-xs text-amber-400">
          {t('reader.offlineCopy', { d: new Date(offlineCopy.savedAt).toLocaleString() })}
        </div>
      )}

      {limitReached ? (
        <div className="px-4 py-16">
          <DownloadWall onUnlocked={loadChapter} />
        </div>
      ) : (
        <article className="mx-auto max-w-3xl px-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <h1 className="mb-6 mt-8 text-2xl font-bold">{chapter ? chapter.title || `#${chapter.index}` : ''}</h1>
          <AdSlot html={ads.reader_top?.html} className="ad-slot my-4" />
          <div
            className="reader-content"
            style={{ ['--reader-font-size']: `${fontSize}px` }}
            dangerouslySetInnerHTML={{ __html: renderedContent || '<p></p>' }}
          />
          <AdSlot html={ads.reader_bottom?.html} className="ad-slot my-8" />
        </article>
      )}

      <div className="mx-auto max-w-3xl px-4">
        <CommentSection targetType="novel_chapter" targetId={chapter ? String(chapter.id) : index} />
      </div>
    </div>
  );
}
