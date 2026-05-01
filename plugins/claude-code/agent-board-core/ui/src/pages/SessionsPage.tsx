import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { SearchIcon } from '../components/SearchIcon';

type Session = {
  id: string;
  projectDir: string | null;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
  compactCount: number;
  firstPrompt?: string | null;
  intent?: string | null;
  role?: string | null;
  topFiles?: Array<{ path: string; count: number }>;
  planFiles?: string[];
  source?: 'agentboard' | 'cli';
  taskCode?: string | null;
  projectCode?: string | null;
  repoPath?: string | null;
  dbHash: string;      // full hash (filename without .db)
  dbHashShort: string; // first 8 chars for display
};

type SourceFilter = 'all' | 'agentboard' | 'cli';

const INTENT_ICON: Record<string, string> = {
  investigate: '🔎',
  implement: '⚙',
  discuss: '💬',
  review: '✓',
};


function timeAgo(iso: string) {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms) || ms < 0) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function durationMin(a: string, b: string) {
  const ma = Date.parse(a), mb = Date.parse(b);
  if (isNaN(ma) || isNaN(mb)) return null;
  return Math.max(0, Math.round((mb - ma) / 60_000));
}

export function SessionsPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const data = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });

  const flat: Session[] = useMemo(() => {
    const out: Session[] = [];
    for (const db of data.data?.dbs ?? []) {
      for (const s of db.sessions) {
        out.push({ ...s, dbHash: db.hash, dbHashShort: db.hash.slice(0, 8) });
      }
    }
    out.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    return out;
  }, [data.data]);

  const sourceCounts = useMemo(() => {
    let agentboard = 0, cli = 0;
    for (const s of flat) {
      if (s.source === 'agentboard') agentboard++;
      else cli++;
    }
    return { all: flat.length, agentboard, cli };
  }, [flat]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return flat.filter(x => {
      if (sourceFilter === 'agentboard' && x.source !== 'agentboard') return false;
      if (sourceFilter === 'cli' && x.source === 'agentboard') return false;
      if (!s) return true;
      return (
        x.id.toLowerCase().includes(s) ||
        (x.projectDir ?? '').toLowerCase().includes(s) ||
        (x.firstPrompt ?? '').toLowerCase().includes(s) ||
        (x.intent ?? '').toLowerCase().includes(s) ||
        (x.role ?? '').toLowerCase().includes(s) ||
        (x.taskCode ?? '').toLowerCase().includes(s) ||
        (x.topFiles ?? []).some(f => f.path.toLowerCase().includes(s)) ||
        (x.planFiles ?? []).some(p => p.toLowerCase().includes(s)) ||
        x.dbHash.includes(s)
      );
    });
  }, [q, flat, sourceFilter]);

  const totals = useMemo(() => {
    const sessions = flat.length;
    const events = flat.reduce((n, s) => n + (s.eventCount || 0), 0);
    const durations = flat.map(s => durationMin(s.startedAt, s.lastEventAt)).filter((x): x is number => x != null);
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return { sessions, events, avg };
  }, [flat]);

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('sessions.title', 'Sessions')}</h1>
          <span className="subtitle">
            {t('sessions.subtitle', 'All recorded AI coding sessions.')}
          </span>
        </div>
        <div className="actions">
          <div className="source-filter" role="tablist" aria-label={t('sessions.filter_source', 'Filter by source')}>
            {(['all', 'agentboard', 'cli'] as SourceFilter[]).map(f => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={sourceFilter === f}
                className={`pill${sourceFilter === f ? ' active' : ''}`}
                onClick={() => setSourceFilter(f)}
              >
                {f === 'all'
                  ? t('sessions.source_all', 'All')
                  : f === 'agentboard'
                    ? t('sessions.source_agentboard', 'Agentboard')
                    : t('sessions.source_cli', 'CLI / Other')}
                <span className="count mono">{sourceCounts[f]}</span>
              </button>
            ))}
          </div>
          <label className="search-bar wide">
            <SearchIcon />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('sessions.search', 'Search project or session id…')}
              aria-label="Search sessions"
              autoComplete="off"
              spellCheck={false}
            />
            {q && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setQ('')}
                aria-label={t('common.clear', 'Clear')}
                title={t('common.clear', 'Clear')}
              >×</button>
            )}
            <span className="search-count mono">
              {filtered.length}/{flat.length}
            </span>
          </label>
        </div>
      </div>

      {data.isLoading ? (
        <div className="center"><div className="spinner" /></div>
      ) : data.isError ? (
        <div className="empty-state">
          <h3>{t('sessions.error_title', 'Could not read sessions')}</h3>
          <p className="muted">{String((data.error as Error)?.message || '')}</p>
        </div>
      ) : data.data?.error ? (
        <div className="empty-state">
          <h3>{t('sessions.unavail_title', 'SQLite adapter unavailable')}</h3>
          <p className="muted">Server reported: {data.data.error}</p>
        </div>
      ) : flat.length === 0 ? (
        <div className="empty-state">
          <h3>{t('sessions.empty_title', 'No sessions recorded')}</h3>
          <p>
            {t('sessions.empty_body', 'context-mode has not written any session databases yet. Expected dir:')}{' '}
            <code>{data.data?.dir}</code>
          </p>
        </div>
      ) : (
        <>
          <div className="session-stats">
            <Stat label={t('sessions.total_sessions', 'Sessions')} value={totals.sessions} />
            <Stat label={t('sessions.total_events', 'Events')} value={totals.events.toLocaleString()} />
            <Stat label={t('sessions.avg_duration', 'Avg duration')} value={`${totals.avg}m`} />
            <Stat label={t('sessions.dbs', 'Databases')} value={data.data?.dbs.length ?? 0} />
          </div>

          {q.trim() && filtered.length === 0 && (
            <div className="empty-state">
              <h3>{t('sessions.no_matches', 'No matches')}</h3>
              <p className="muted">
                {t('sessions.no_matches_hint', 'No session matches')} <code>{q.trim()}</code>
              </p>
            </div>
          )}

          <div className="session-list">
            {filtered.map(s => {
              const dur = durationMin(s.startedAt, s.lastEventAt);
              return (
                <Link
                  key={`${s.dbHash}:${s.id}`}
                  to={`/sessions/${encodeURIComponent(s.dbHash)}/${encodeURIComponent(s.id)}`}
                  className="session-row"
                >
                  <div className="session-main">
                    <div className="session-title oneline" title={s.firstPrompt ?? undefined}>
                      {s.source === 'agentboard' && (
                        <span
                          className="session-tag source agentboard"
                          title={s.taskCode ? `${t('sessions.source_agentboard', 'Agentboard')} · ${s.taskCode}${s.role ? ' · ' + s.role : ''}` : t('sessions.source_agentboard', 'Agentboard')}
                        >
                          {s.taskCode ?? t('sessions.source_agentboard', 'Agentboard')}
                          {s.role ? ` · ${s.role}` : ''}
                        </span>
                      )}
                      {s.firstPrompt
                        ? <span className="quoted">“{s.firstPrompt}”</span>
                        : <span className="muted">{t('sessions.untitled', 'No prompt recorded')}</span>}
                    </div>
                    <div className="session-sub mono" title={s.projectDir ?? undefined}>
                      {s.projectDir || '—'}
                    </div>
                    <div className="session-meta mono">
                      {s.id.slice(0, 12)} · db:{s.dbHashShort}
                      <ResumeInline
                        sessionId={s.id}
                        repoPath={s.repoPath ?? s.projectDir}
                      />
                    </div>
                  </div>
                  <div className="session-stat intent-col">
                    <span className="label">{t('sessions.intent', 'Intent')}</span>
                    <span className="value">
                      {s.intent ? (
                        <span className={`session-tag intent intent-${s.intent}`}>
                          <span aria-hidden>{INTENT_ICON[s.intent] || '•'}</span>
                          {s.intent}
                        </span>
                      ) : <span className="muted">—</span>}
                    </span>
                  </div>
                  <div className="session-stat">
                    <span className="label">{t('sessions.started', 'Started')}</span>
                    <span className="value">{timeAgo(s.startedAt)}</span>
                  </div>
                  <div className="session-stat">
                    <span className="label">{t('sessions.duration', 'Duration')}</span>
                    <span className="value">{dur != null ? `${dur}m` : '—'}</span>
                  </div>
                  <div className="session-stat">
                    <span className="label">{t('sessions.events', 'Events')}</span>
                    <span className="value">{s.eventCount ?? 0}</span>
                  </div>
                  <div className="session-stat">
                    <span className="label">{t('sessions.last', 'Last')}</span>
                    <span className="value">{timeAgo(s.lastEventAt)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="session-kpi">
      <div className="session-kpi-value">{value}</div>
      <div className="session-kpi-label">{label}</div>
    </div>
  );
}

function ResumeInline({
  sessionId, repoPath,
}: { sessionId: string; repoPath: string | null | undefined }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const cmd = repoPath
    ? `cd "${repoPath}"; claude --resume ${sessionId}`
    : `claude --resume ${sessionId}`;
  return (
    <button
      type="button"
      className="linkish resume-inline"
      title={cmd}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {}
      }}
    >
      {copied ? t('common.copied', 'Copied ✓') : `⏎ ${t('task.resume', 'Open in CLI')}`}
    </button>
  );
}
