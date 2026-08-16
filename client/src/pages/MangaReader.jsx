import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { saveChapter, getChapter } from '../offline';
import AdSlot from '../components/AdSlot';
import CommentSection from '../components/CommentSection';
import DownloadWall from '../components/DownloadWall';

const RETRY_DELAYS = [1500, 3000, 6000];

export default function MangaReader() {
  const { mangaId, chapterId } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [chapter, setChapter] = useState(null);
  const [pages, setPages] = useState([]);
  const [externalUrl, setExternalUrl] = useState(null);
  const [ads, setAds] = useState({});
  const [limitReached, setLimitReached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('single'); // single | double
  const [download, setDownload] = useState(null);
  const [dlStatus, setDlStatus] = useState('idle'); // idle | saving | done | error
  const [dlProgress, setDlProgress] = useState(0);
  const [zipStatus, setZipStatus] = useState('idle'); // idle | saving | done | error
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
      const data = await api(`/reader/manga/${mangaId}/chapters/${chapterId}/pages`);
      setChapter(data.chapter);
      setPages(data.pages || []);
      setExternalUrl(data.externalUrl || null);
      setDownload(data.download);
    } catch (err) {
      if (err.status === 429 && err.data && err.data.requiredAd) {
        setLimitReached(true);
      } else {
        // network failure → fall back to the saved offline copy
        try {
          const copy = await getChapter(`manga:${chapterId}`);
          if (copy && copy.pages && copy.pages.length) {
            setOfflineCopy(copy);
            setChapter({ id: chapterId, number: copy.number, title: copy.title });
            setPages(copy.pages.map((url, i) => ({ index: i, url })));
            setExternalUrl(copy.externalUrl || null);
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
  }, [mangaId, chapterId]);

  // server-side ZIP download of the whole chapter (counts against the daily limit)
  const downloadZip = async () => {
    setZipStatus('saving');
    try {
      const res = await fetch(`/api/reader/chapters/${chapterId}/download`, { credentials: 'same-origin' });
      if (res.status === 429) {
        setZipStatus('idle');
        setLimitReached(true); // show the rewarded download wall
        return;
      }
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `chapter-${chapterId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      setZipStatus('done');
    } catch {
      setZipStatus('error');
    }
  };

  // pre-cache all page images + save the chapter manifest for offline reading
  const saveOffline = async () => {
    setDlStatus('saving');
    setDlProgress(0);
    try {
      for (let i = 0; i < pages.length; i++) {
        await fetch(`/api/reader/image/${chapterId}/${i}`, { credentials: 'same-origin' });
        setDlProgress(i + 1);
      }
      await saveChapter(`manga:${chapterId}`, {
        type: 'manga',
        chapterId,
        mangaId,
        number: chapter ? chapter.number : null,
        title: chapter ? chapter.title : '',
        pages: pages.map((p) => p.url),
        externalUrl,
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

  // scroll progress → reading history (debounced)
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
          body: { target_type: 'manga', target_id: mangaId, chapter_id: chapterId, progress },
        }).catch(() => {});
      }
    }, 500);
  }, [user, mangaId, chapterId]);

  const inReaderEvery = parseInt(ads.in_reader?.position?.every || 8, 10);
  const pageRows = mode === 'double' ? pairPages(pages) : pages.map((p) => [p]);

  if (loading) return <div className="px-4 py-24 text-center text-sm text-slate-500">{t('reader.loading')}</div>;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="reader reader-theme-dark min-h-screen pb-16">
      {/* top bar */}
      <div className="sticky top-14 z-30 border-b border-surface-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2.5">
          <Link to={`/manga/${mangaId}`} className="btn-ghost !px-3 !py-1.5 text-xs">
            {t('reader.back')}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {chapter ? `${t('manga.chapterNum', { n: chapter.number })}${chapter.title ? ` — ${chapter.title}` : ''}` : ''}
            </p>
            {download && (
              <p className="text-[10px] text-slate-500">{t('reader.today', { used: download.used, total: download.limit + download.bonus })}</p>
            )}
          </div>
          {pages.length > 0 && !limitReached && (
            <>
              <button
                className="btn-ghost !px-3 !py-1.5 text-xs"
                onClick={saveOffline}
                disabled={dlStatus === 'saving'}
                title={t('reader.download')}
              >
                {dlStatus === 'saving'
                  ? t('reader.downloading', { n: dlProgress, total: pages.length })
                  : dlStatus === 'done'
                    ? t('reader.downloaded')
                    : '⬇'}
              </button>
              <button
                className="btn-ghost !px-3 !py-1.5 text-xs"
                onClick={downloadZip}
                disabled={zipStatus === 'saving'}
                title={t('reader.downloadZip')}
              >
                {zipStatus === 'saving' ? t('reader.preparingZip') : zipStatus === 'done' ? t('reader.downloaded') : '📦'}
              </button>
            </>
          )}
          <button
            className="btn-ghost !px-3 !py-1.5 text-xs"
            onClick={() => setMode((m) => (m === 'single' ? 'double' : 'single'))}
          >
            {mode === 'single' ? t('reader.double') : t('reader.single')}
          </button>
        </div>
      </div>

      {offlineCopy && (
        <div className="mx-auto max-w-4xl px-4 pt-3 text-center text-xs text-amber-400">
          {t('reader.offlineCopy', { d: new Date(offlineCopy.savedAt).toLocaleString() })}
        </div>
      )}

      {zipStatus === 'error' && (
        <div className="mx-auto max-w-4xl px-4 pt-3 text-center text-xs text-rose-400">
          {t('reader.downloadFail')}{' '}
          <button className="underline" onClick={downloadZip}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {limitReached ? (
        <div className="px-4 py-16">
          <DownloadWall onUnlocked={loadChapter} />
        </div>
      ) : externalUrl && pages.length === 0 ? (
        <div className="mx-auto max-w-2xl px-4 py-24 text-center">
          <p className="text-slate-400">{t('manga.readOnSource')}</p>
          <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="btn-primary mt-4 inline-flex">
            {t('manga.readOnSource')}
          </a>
        </div>
      ) : pages.length === 0 ? (
        <div className="px-4 py-24 text-center text-sm text-slate-500">
          {t('common.loading')}
          <button className="btn-ghost ms-3" onClick={loadChapter}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div className="mx-auto max-w-4xl px-2 sm:px-4">
          <AdSlot html={ads.reader_top?.html} className="ad-slot my-4 text-center" />
          <div className="manga-pages space-y-2">
            {pageRows.map((row, i) => {
              const baseIndex = mode === 'double' ? i * 2 : i;
              return (
                <div key={baseIndex} className={mode === 'double' ? 'flex gap-1 sm:gap-2' : ''}>
                  {row.map((p) => (
                    <PageImage key={p.index} src={p.url} alt={`${t('reader.page', { n: p.index + 1 })}`} single={mode === 'single'} />
                  ))}
                  {/* in-reader ad every N images */}
                  {inReaderEvery > 0 && (baseIndex + 1) % inReaderEvery === 0 && (
                    <div className="my-4 w-full text-center">
                      <AdSlot html={ads.in_reader?.html} className="ad-slot" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <AdSlot html={ads.reader_bottom?.html} className="ad-slot my-6 text-center" />
        </div>
      )}

      <div className="mx-auto max-w-4xl px-4">
        <CommentSection targetType="manga_chapter" targetId={String(chapterId)} />
      </div>
    </div>
  );
}

/** Chapter page image with automatic retry (3 attempts, backoff) and a
 *  manual retry button after exhaustion. */
function PageImage({ src, alt, single }) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef(null);

  useEffect(() => {
    if (failed) return undefined;
    if (attempt === 0) return undefined;
    // schedule the next attempt after the backoff delay
    retryTimer.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)]);
    return () => clearTimeout(retryTimer.current);
  }, [attempt, failed]);

  const handleError = () => {
    if (attempt < RETRY_DELAYS.length) {
      setAttempt((a) => a + 1);
    } else {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <div className={`flex ${single ? 'mx-auto h-64 max-w-3xl' : 'h-48 w-1/2'} flex-col items-center justify-center gap-2 rounded-lg bg-surface-soft px-4 text-center text-xs text-slate-400`}>
        <span>{alt}</span>
        <span>{t('reader.imagePending')}</span>
        <button className="btn-ghost !py-1 text-xs" onClick={() => { setFailed(false); setAttempt(0); }}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <img
      key={attempt}
      src={attempt ? `${src}?r=${attempt}` : src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={handleError}
      className={single ? 'mx-auto h-auto w-full max-w-3xl' : 'h-auto w-1/2'}
    />
  );
}

function pairPages(pages) {
  const rows = [];
  for (let i = 0; i < pages.length; i += 2) {
    rows.push([pages[i], pages[i + 1]].filter(Boolean));
  }
  return rows;
}
