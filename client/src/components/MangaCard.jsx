import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export default function MangaCard({ item, type = 'manga' }) {
  const { t } = useI18n();
  const href = type === 'manga' ? `/manga/${item.id}` : `/novel/${item.id}`;
  const cover = item.cover_url
    ? `/api/proxy/image?url=${encodeURIComponent(item.cover_url)}`
    : null;
  return (
    <Link
      to={href}
      className="group overflow-hidden rounded-xl border border-surface-border bg-surface-card transition hover:-translate-y-0.5 hover:border-accent/60"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-surface-soft">
        {cover ? (
          <img
            src={cover}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-slate-500">
            {item.title}
          </div>
        )}
        {item.score != null && (
          <span className="absolute start-2 top-2 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {item.score}%
          </span>
        )}
        {!!item.chapter_count && (
          <span className="absolute bottom-2 end-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-slate-200">
            {item.chapter_count} {t('common.chaptersShort')}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <h3 className="line-clamp-2 text-sm font-medium text-slate-200 group-hover:text-white">{item.title}</h3>
        {item.author && <p className="mt-0.5 truncate text-xs text-slate-500">{item.author}</p>}
      </div>
    </Link>
  );
}
