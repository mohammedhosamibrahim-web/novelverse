import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

const SLOT_HELP_KEY = {
  header: 'admin.slotHelp.header',
  reader_top: 'admin.slotHelp.reader_top',
  reader_bottom: 'admin.slotHelp.reader_bottom',
  in_reader: 'admin.slotHelp.in_reader',
  download_wall: 'admin.slotHelp.download_wall',
  sidebar: 'admin.slotHelp.sidebar',
  footer: 'admin.slotHelp.footer',
};

export default function Admin() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [tab, setTab] = useState('users');
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-black text-white">{t('admin.title')}</h1>

      {/* Super Admin account card — credentials reference for login */}
      {user && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-accent/40 bg-accent/10 p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-accent-soft">{t('admin.ownerTitle')}</p>
            <p className="mt-0.5 text-lg font-black text-white">{user.username}</p>
            <p className="truncate text-sm text-slate-300">{user.email}</p>
            <span className="mt-1 inline-block rounded bg-accent/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-soft">
              super_admin
            </span>
          </div>
          <div className="ms-auto text-right text-xs text-slate-400">
            <p>{t('admin.ownerCreated')}: {user.created_at ? user.created_at.slice(0, 10) : '—'}</p>
            <p className="mt-1">ID: {user.id}</p>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          ['users', t('admin.usersTab')],
          ['ads', t('admin.adsTab')],
          ['sync', t('admin.syncTab')],
          ['sources', t('admin.sourcesTab')],
          ['settings', t('admin.settingsTab')],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-accent text-white' : 'bg-surface-card text-slate-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === 'users' && <UsersTab />}
        {tab === 'ads' && <AdsTab />}
        {tab === 'sync' && <SyncTab />}
        {tab === 'sources' && <SourcesTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

/* ── Users & roles ─────────────────────────────────────────────────────── */

function UsersTab() {
  const { t } = useI18n();
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api('/admin/users').then((d) => setUsers(d.users)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const changeRole = async (u, role) => {
    setMsg('');
    try {
      await api(`/admin/users/${u.id}/role`, { method: 'PATCH', body: { role } });
      setMsg(t('admin.roleUpdated', { name: u.username, role }));
      load();
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    }
  };

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <h2 className="mb-3 font-bold text-white">{t('admin.registeredUsers')}</h2>
      {msg && <p className="mb-3 text-sm text-slate-300">{msg}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pe-4">{t('admin.id')}</th>
              <th className="py-2 pe-4">{t('admin.username')}</th>
              <th className="py-2 pe-4">{t('admin.email')}</th>
              <th className="py-2 pe-4">{t('admin.role')}</th>
              <th className="py-2">{t('admin.action')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-surface-border/50">
                <td className="py-2 pe-4 text-slate-500">{u.id}</td>
                <td className="py-2 pe-4 font-medium text-slate-200">
                  {u.username}
                  {u.role === 'super_admin' && <span className="ms-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent-soft">{t('admin.you')}</span>}
                </td>
                <td className="py-2 pe-4 text-slate-400">{u.email}</td>
                <td className="py-2 pe-4">
                  <span className="rounded bg-surface-soft px-2 py-0.5 text-xs capitalize text-slate-300">{u.role}</span>
                </td>
                <td className="py-2">
                  {u.role === 'super_admin' ? (
                    <span className="text-xs text-slate-600">—</span>
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value)}
                      className="rounded-lg border border-surface-border bg-surface-soft px-2 py-1 text-xs text-slate-200"
                    >
                      <option value="user">{t('admin.userRole')}</option>
                      <option value="moderator">{t('admin.moderatorRole')}</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Ad management panel ──────────────────────────────────────────────── */

function AdsTab() {
  const { t } = useI18n();
  const [slots, setSlots] = useState([]);
  const [saving, setSaving] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api('/admin/ads').then((d) => setSlots(d.slots)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const update = (key, patch) => {
    setSlots((s) => s.map((x) => (x.slot_key === key ? { ...x, ...patch } : x)));
  };

  const save = async (slot) => {
    setSaving(slot.slot_key);
    setMsg('');
    try {
      await api(`/admin/ads/${slot.slot_key}`, {
        method: 'PUT',
        body: { html: slot.html, enabled: slot.enabled, position: slot.position },
      });
      setMsg(t('admin.saved', { name: slot.name }));
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
        <h2 className="font-bold text-white">{t('admin.adsTitle')}</h2>
        <p className="mt-1 text-xs text-slate-500">{t('admin.adsDesc')}</p>
        {msg && <p className="mt-2 text-sm text-slate-300">{msg}</p>}
      </div>
      {slots.map((slot) => (
        <div key={slot.slot_key} className="rounded-2xl border border-surface-border bg-surface-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-bold text-white">{slot.name}</h3>
            <code className="rounded bg-surface-soft px-2 py-0.5 text-[11px] text-accent-soft">{slot.slot_key}</code>
            <label className="ms-auto flex cursor-pointer items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={!!slot.enabled}
                onChange={(e) => update(slot.slot_key, { enabled: e.target.checked })}
                className="accent-indigo-500"
              />
              {t('admin.enabled')}
            </label>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t(SLOT_HELP_KEY[slot.slot_key] || 'admin.slotHelp.custom')}</p>
          <textarea
            value={slot.html}
            onChange={(e) => update(slot.slot_key, { html: e.target.value })}
            rows={4}
            spellCheck={false}
            className="input-field mt-3 font-mono text-xs"
            placeholder="<script async src=...></script> or <div class='banner'>…</div>"
          />
          {slot.slot_key === 'in_reader' && (
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <span>{t('admin.every')}</span>
              <input
                type="number"
                min={1}
                max={100}
                value={slot.position?.every || 8}
                onChange={(e) => update(slot.slot_key, { position: { ...slot.position, every: parseInt(e.target.value, 10) || 8 } })}
                className="w-16 rounded border border-surface-border bg-surface-soft px-2 py-1 text-slate-200"
              />
              <span>{t('admin.imagesParagraphs')}</span>
            </div>
          )}
          <button className="btn-primary mt-3" disabled={saving === slot.slot_key} onClick={() => save(slot)}>
            {saving === slot.slot_key ? t('admin.saving') : t('admin.saveSlot')}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Mirror image fetch card ──────────────────────────────────────────── */

function MirrorFetchCard() {
  const { t } = useI18n();
  const [mangaId, setMangaId] = useState('');
  const [state, setState] = useState(null);
  const [msg, setMsg] = useState('');

  const loadState = useCallback(() => {
    api('/admin/mirror-fetch/status').then(setState).catch(() => {});
  }, []);
  useEffect(loadState, [loadState]);

  const running = state?.running;
  useEffect(() => {
    if (!running) return undefined;
    const interval = setInterval(loadState, 2000);
    return () => clearInterval(interval);
  }, [running, loadState]);

  const start = async () => {
    setMsg('');
    try {
      const r = await api('/admin/mirror-fetch', { method: 'POST', body: { mangaId: parseInt(mangaId, 10) } });
      setMsg(r.started ? `${t('admin.syncStarted')} (${r.total})` : t('admin.alreadyRunning'));
      setTimeout(loadState, 1200);
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    }
  };

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <h2 className="font-bold text-white">{t('admin.mirrorTitle')}</h2>
      <p className="mt-1 text-xs text-slate-500">{t('admin.mirrorDesc')}</p>
      <div className="mt-3 flex gap-2">
        <input
          type="number"
          min={1}
          value={mangaId}
          onChange={(e) => setMangaId(e.target.value)}
          placeholder={t('admin.mirrorMangaId')}
          className="input-field w-40"
        />
        <button className="btn-primary" disabled={!mangaId || running} onClick={start}>
          {running ? t('admin.syncing') : t('admin.mirrorBtn')}
        </button>
      </div>
      {running && state && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded bg-surface-soft">
            <div
              className="h-full rounded bg-accent transition-all"
              style={{ width: `${state.total ? Math.min(100, (state.done / state.total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('admin.mirrorProgress', { done: state.done, total: state.total, ok: state.ok, failed: state.failed })} · {state.current}
          </p>
        </div>
      )}
      {!running && state && state.done > 0 && (
        <p className="mt-2 text-xs text-emerald-400">
          {t('admin.mirrorProgress', { done: state.done, total: state.total, ok: state.ok, failed: state.failed })}
        </p>
      )}
      {msg && <p className="mt-2 text-sm text-slate-300">{msg}</p>}
    </div>
  );
}

/* ── API sources management ───────────────────────────────────────────── */

const STATUS_BADGE = {
  ok: 'bg-emerald-500/20 text-emerald-400',
  slow: 'bg-amber-500/20 text-amber-400',
  down: 'bg-rose-500/20 text-rose-400',
  degraded: 'bg-orange-500/20 text-orange-400',
  unknown: 'bg-surface-soft text-slate-400',
};
const TYPE_LABEL = { manga: 'Manga/Chapters', image: 'Images CDN', metadata: 'Metadata' };

function SourcesTab() {
  const { t } = useI18n();
  const [sources, setSources] = useState([]);
  const [checking, setChecking] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api('/admin/sources').then((d) => setSources(d.sources)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const patch = async (id, body) => {
    setMsg('');
    try {
      await api(`/admin/sources/${id}`, { method: 'PATCH', body });
      load();
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    }
  };

  const checkHealth = async () => {
    setChecking(true);
    setMsg('');
    try {
      const d = await api('/admin/sources/check', { method: 'POST', body: {} });
      setSources(d.sources);
      setMsg(t('admin.checkHealth') + ' ✓');
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    } finally {
      setChecking(false);
    }
  };

  const syncAll = async () => {
    setSyncingAll(true);
    setMsg('');
    try {
      const d = await api('/admin/sync-all', { method: 'POST', body: {} });
      setMsg(`${t('admin.syncStarted')} — ${d.sources.join(' → ')}`);
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
      <h2 className="font-bold text-white">{t('admin.sourcesTitle')}</h2>
      <p className="mt-1 text-xs text-slate-500">{t('admin.sourcesDesc')}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" disabled={checking} onClick={checkHealth}>
          {checking ? t('admin.checking') : t('admin.checkHealth')}
        </button>
        <button className="btn-primary !bg-emerald-600 hover:!bg-emerald-500" disabled={syncingAll} onClick={syncAll}>
          {syncingAll ? t('admin.syncing') : t('admin.syncAllSources')}
        </button>
      </div>

      {msg && <p className="mt-3 text-sm text-slate-300">{msg}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pe-4">{t('admin.sourceTitle')}</th>
              <th className="py-2 pe-4">{t('admin.type')}</th>
              <th className="py-2 pe-4">{t('admin.status')}</th>
              <th className="py-2 pe-4">{t('admin.latency')}</th>
              <th className="py-2 pe-4">{t('admin.priority')}</th>
              <th className="py-2">{t('admin.enabled')}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-b border-surface-border/50">
                <td className="py-2 pe-4">
                  <span className="font-semibold text-slate-200">{s.name}</span>
                  <code className="ms-2 rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-accent-soft">{s.id}</code>
                </td>
                <td className="py-2 pe-4 text-slate-400">{TYPE_LABEL[s.type] || s.type}</td>
                <td className="py-2 pe-4">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[s.status] || STATUS_BADGE.unknown}`}>
                    {t(`admin.status${s.status.charAt(0).toUpperCase()}${s.status.slice(1)}`)}
                  </span>
                </td>
                <td className="py-2 pe-4 text-slate-400">
                  {s.latency_ms ? `${s.latency_ms}ms` : '—'}
                </td>
                <td className="py-2 pe-4">
                  <div className="flex items-center gap-1">
                    <button
                      className="rounded bg-surface-soft px-1.5 py-0.5 text-xs text-slate-300 hover:text-white"
                      disabled={s.priority <= 1}
                      onClick={() => patch(s.id, { priority: s.priority - 1 })}
                    >
                      ▲
                    </button>
                    <span className="w-6 text-center text-xs text-slate-300">{s.priority}</span>
                    <button
                      className="rounded bg-surface-soft px-1.5 py-0.5 text-xs text-slate-300 hover:text-white"
                      disabled={s.priority >= 100}
                      onClick={() => patch(s.id, { priority: s.priority + 1 })}
                    >
                      ▼
                    </button>
                  </div>
                </td>
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => patch(s.id, { enabled: e.target.checked })}
                    className="accent-indigo-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">{t('admin.sourcesNote')}</p>
    </div>
  );
}

/* ── Content sync ──────────────────────────────────────────────────────── */

function SyncTab() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState('');
  const [msg, setMsg] = useState('');
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [tocUrl, setTocUrl] = useState('');
  const [importing, setImporting] = useState(false);
  // source config
  const [cfg, setCfg] = useState({ content_source: 'mangadex', alt_api_base: '', image_fallback_proxy: '' });

  const loadStatus = useCallback(() => {
    api('/admin/sync/status').then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    loadStatus();
    api('/admin/novels/sources').then((d) => setSources(d.sources)).catch(() => {});
    api('/admin/settings').then((d) => setCfg(d.settings)).catch(() => {});
  }, [loadStatus]);

  // live progress polling while a sync is running
  const running = status?.running || !!status?.progress;
  useEffect(() => {
    if (!running) return undefined;
    const interval = setInterval(loadStatus, 2000);
    return () => clearInterval(interval);
  }, [running, loadStatus]);

  const triggerSync = async (mode) => {
    setSyncing(mode);
    setMsg('');
    try {
      const r = await api('/admin/sync', { method: 'POST', body: { mode } });
      if (r.started) setMsg(mode === 'super' ? t('admin.syncingAll') : mode === 'anilist' ? t('admin.anilistStarted') : t('admin.syncStarted'));
      else setMsg(t('admin.alreadyRunning'));
      setTimeout(loadStatus, 1500);
    } catch (err) {
      setMsg(t('admin.syncFailed', { msg: err.message }));
    } finally {
      setSyncing('');
    }
  };

  const saveSource = async () => {
    setMsg('');
    try {
      await api('/admin/settings', { method: 'PUT', body: cfg });
      setMsg(t('admin.sourceSaved'));
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    }
  };

  const doImport = async (e) => {
    e.preventDefault();
    setImporting(true);
    setMsg('');
    try {
      const r = await api('/admin/novels/import', { method: 'POST', body: { sourceId, tocUrl } });
      setMsg(`${t('admin.saved', { name: `"${r.title}"` })} — ${r.chapterCount} chapters`);
      setTocUrl('');
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    } finally {
      setImporting(false);
    }
  };

  const enabledSources = sources.filter((s) => s.enabled);
  const syncButtons = [
    ['daily', t('admin.syncDaily')],
    ['ongoing', t('admin.syncOngoing')],
    ['popular', t('admin.syncPopular')],
    ['latest', t('admin.syncLatest')],
    ['refresh', t('admin.refreshExisting')],
  ];
  const progress = status?.progress;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        {/* Source switcher */}
        <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="font-bold text-white">{t('admin.sourceTitle')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('admin.sourceDesc')}</p>
          <p className="mt-2 text-xs font-semibold text-accent-soft">
            {t('admin.sourceActive', { s: cfg.content_source === 'alternative' ? t('admin.sourceAlt') : t('admin.sourceMangaDex') })}
          </p>
          <div className="mt-3 flex gap-2">
            {[
              ['mangadex', t('admin.sourceMangaDex')],
              ['alternative', t('admin.sourceAlt')],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setCfg({ ...cfg, content_source: value })}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  cfg.content_source === value ? 'bg-accent text-white' : 'bg-surface-soft text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {cfg.content_source === 'alternative' && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">{t('admin.altApiBase')}</label>
                <input
                  value={cfg.alt_api_base}
                  onChange={(e) => setCfg({ ...cfg, alt_api_base: e.target.value })}
                  className="input-field font-mono text-xs"
                  placeholder="https://api.example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">{t('admin.fallbackProxy')}</label>
                <input
                  value={cfg.image_fallback_proxy}
                  onChange={(e) => setCfg({ ...cfg, image_fallback_proxy: e.target.value })}
                  className="input-field font-mono text-xs"
                  placeholder="https://proxy.example.com/?url={url}"
                />
              </div>
            </div>
          )}
          <button className="btn-primary mt-3" onClick={saveSource}>
            {t('admin.saveSource')}
          </button>
        </div>

        {/* MangaDex sync + progress */}
        <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="font-bold text-white">{t('admin.syncManga')}</h2>
          {status && (
            <div className="mt-3 space-y-1 text-sm text-slate-400">
              <p>{t('admin.lastRun', { t: status.lastRun || '—' })}</p>
              <p>{t('admin.mangaInDb', { m: status.mangaCount, c: status.chapterCount })}</p>
              {status.lastError && <p className="text-rose-400">{t('admin.lastError', { e: status.lastError })}</p>}
            </div>
          )}

          {/* live progress bar */}
          {running && progress && (
            <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 p-4">
              <p className="mb-2 text-xs text-slate-300">{t('admin.syncingAll')}</p>
              <div className="h-2.5 w-full overflow-hidden rounded bg-surface-soft">
                <div
                  className="h-full rounded bg-accent transition-all"
                  style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-2 truncate text-xs text-slate-400">
                {t('admin.progress', { done: progress.done, total: progress.total, current: progress.current || '…' })}
              </p>
            </div>
          )}

          <button
            className="btn-primary mt-4 w-full !bg-emerald-600 hover:!bg-emerald-500"
            disabled={!!syncing || running}
            onClick={() => triggerSync('super')}
          >
            {syncing === 'super' ? t('admin.syncing') : t('admin.syncAll')}
          </button>
          <div className="mt-3 flex flex-col gap-2">
            {syncButtons.map(([mode, label]) => (
              <button key={mode} className="btn-primary" disabled={!!syncing || running} onClick={() => triggerSync(mode)}>
                {syncing === mode ? t('admin.syncing') : label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            {t('admin.syncSchedNote', { h: '3' })} — daily bulk (75 new) + ongoing tracking (30 min)
          </p>
        </div>

        {/* Other sources sync (non-MangaDex) */}
        <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="font-bold text-white">{t('admin.otherSources')}</h2>
          <button
            className="btn-primary mt-3 w-full"
            disabled={!!syncing || running}
            onClick={() => triggerSync('anilist')}
          >
            {syncing === 'anilist' ? t('admin.syncing') : t('admin.syncAniList')}
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {['comick', 'consumet'].map((id) => (
              <button key={id} className="btn-ghost cursor-not-allowed opacity-50" disabled title={t('admin.sourceUnavailable')}>
                {id}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t('admin.otherSourcesNote')}</p>
        </div>

        {/* Mirror image fetch (pull chapter images from external providers) */}
        <MirrorFetchCard />
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
        <h2 className="font-bold text-white">{t('admin.novelImport')}</h2>
        {enabledSources.length === 0 ? (
          <p className="mt-2 text-sm text-amber-400">{t('admin.noSources')}</p>
        ) : (
          <form onSubmit={doImport} className="mt-3 space-y-3">
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="input-field" required>
              <option value="">{t('admin.selectSource')}</option>
              {enabledSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              value={tocUrl}
              onChange={(e) => setTocUrl(e.target.value)}
              placeholder={t('admin.tocUrl')}
              className="input-field"
              required
            />
            <button className="btn-primary" disabled={importing || !sourceId || !tocUrl}>
              {importing ? t('admin.importing') : t('admin.importBtn')}
            </button>
          </form>
        )}
        <p className="mt-2 text-[11px] text-slate-500">{t('admin.importNote')}</p>
      </div>

      {msg && <p className="text-sm text-slate-300 lg:col-span-2">{msg}</p>}
    </div>
  );
}

/* ── Settings ──────────────────────────────────────────────────────────── */

function SettingsTab() {
  const { t } = useI18n();
  const [settings, setSettings] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api('/admin/settings').then((d) => setSettings(d.settings)).catch(() => {});
  }, []);

  if (!settings) return <p className="text-sm text-slate-500">{t('common.loading')}</p>;

  const save = async () => {
    setMsg('');
    try {
      await api('/admin/settings', { method: 'PUT', body: settings });
      setMsg(t('admin.settingsSaved'));
    } catch (err) {
      setMsg(t('admin.failed', { msg: err.message }));
    }
  };

  const fields = [
    ['download_limit', t('admin.dailyLimit')],
    ['reward_bonus', t('admin.rewardBonus')],
    ['reward_validity_hours', t('admin.validityHours')],
    ['reward_token_ttl_min', t('admin.tokenTtl')],
  ];

  return (
    <div className="max-w-md rounded-2xl border border-surface-border bg-surface-card p-5">
      <h2 className="font-bold text-white">{t('admin.settingsTitle')}</h2>
      <div className="mt-4 space-y-4">
        {fields.map(([key, label]) => (
          <div key={key}>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={settings[key]}
              onChange={(e) => setSettings({ ...settings, [key]: parseInt(e.target.value, 10) || 1 })}
              className="input-field"
            />
          </div>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm text-slate-300">{msg}</p>}
      <button className="btn-primary mt-4" onClick={save}>
        {t('admin.saveSettings')}
      </button>
    </div>
  );
}
