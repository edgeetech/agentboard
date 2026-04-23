import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

function projectName(dir: string | null | undefined) {
  if (!dir) return '—';
  return dir.split(/[\\/]/).filter(Boolean).slice(-1)[0] || dir;
}

function formatDuration(a?: string | null, b?: string | null) {
  if (!a || !b) return '—';
  const ms = Math.max(0, Date.parse(b) - Date.parse(a));
  if (isNaN(ms)) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function SessionDetailPage() {
  const { t } = useTranslation();
  const { hash = '', sessionId = '' } = useParams();
  const q = useQuery({
    queryKey: ['session-events', hash, sessionId],
    queryFn: () => api.sessionEvents(hash, sessionId),
  });

  const [showResume, setShowResume] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const data = q.data;
  const events = data?.events ?? [];
  const meta = data?.meta;

  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of events) m[e.type] = (m[e.type] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [events]);

  const topTypes = typeCounts.slice(0, 8);
  const totalTop = topTypes.reduce((n, [, c]) => n + c, 0) || 1;

  if (q.isLoading) return <div className="center"><div className="spinner" /></div>;
  if (q.isError) return (
    <div className="empty-state">
      <h3>{t('sessions.detail_error', 'Could not load session')}</h3>
      <p className="muted">{String((q.error as Error)?.message || '')}</p>
      <p><Link to="/sessions">← {t('nav.sessions', 'Sessions')}</Link></p>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('sessions.detail_title', 'Session detail')}</h1>
          <span className="subtitle">
            <Link to="/sessions">{t('nav.sessions', 'Sessions')}</Link>{' '}
            <span className="muted">/</span>{' '}
            <span className="mono">{sessionId.slice(0, 12)}</span>
          </span>
        </div>
        <div className="actions">
          <Link to="/sessions"><button className="ghost" type="button">← {t('nav.sessions', 'Sessions')}</button></Link>
        </div>
      </div>

      <div className="session-detail-meta form-card" style={{ maxWidth: 'none', marginBottom: '1rem' }}>
        <div className="session-meta-grid">
          <div><div className="k">{t('sessions.project', 'Project')}</div><div className="v">{projectName(meta?.project_dir)}</div></div>
          <div><div className="k">{t('sessions.session_id', 'Session ID')}</div><div className="v mono">{sessionId}</div></div>
          <div><div className="k">{t('sessions.db_hash', 'DB hash')}</div><div className="v mono">{hash}</div></div>
        </div>
      </div>

      <div className="session-stats">
        <div className="session-kpi">
          <div className="session-kpi-value">{events.length}</div>
          <div className="session-kpi-label">{t('sessions.total_events', 'Events')}</div>
        </div>
        <div className="session-kpi">
          <div className="session-kpi-value">{formatDuration(events[0]?.created_at, events[events.length - 1]?.created_at)}</div>
          <div className="session-kpi-label">{t('sessions.duration', 'Duration')}</div>
        </div>
        <div className="session-kpi">
          <div className="session-kpi-value">{typeCounts.length}</div>
          <div className="session-kpi-label">{t('sessions.types', 'Types')}</div>
        </div>
        <div className="session-kpi">
          <div className="session-kpi-value">{meta?.compact_count ?? 0}</div>
          <div className="session-kpi-label">{t('sessions.compacts', 'Compacts')}</div>
        </div>
      </div>

      {topTypes.length > 0 && (
        <>
          <h3 style={{ marginBottom: '0.5rem' }}>{t('sessions.breakdown', 'Event breakdown')}</h3>
          <div className="ratio-bar">
            {topTypes.map(([type, n], i) => (
              <span
                key={type}
                className={`ratio-seg seg-${i % 8}`}
                style={{ width: `${(n * 100) / totalTop}%` }}
                title={`${type}: ${n}`}
              />
            ))}
          </div>
          <div className="type-tags">
            {typeCounts.map(([type, n]) => (
              <span key={type} className="type-tag">{type}<span className="n">{n}</span></span>
            ))}
          </div>
        </>
      )}

      <h3 style={{ margin: '1.25rem 0 0.5rem' }}>{t('sessions.timeline', 'Event timeline')}</h3>
      <div className="event-timeline">
        {events.length === 0 && <div className="muted" style={{ padding: '1rem' }}>(no events)</div>}
        {events.map(e => {
          const prio = e.priority ?? 0;
          const dataStr = e.data ?? '';
          const truncated = dataStr.length > 140;
          const isOpen = expanded[e.id];
          return (
            <div key={e.id} className={`event-row prio-${Math.min(4, Math.max(0, prio))}`}>
              <div className="event-time mono">{(e.created_at || '').replace('T', ' ').slice(0, 19)}</div>
              <div className="event-type-badge">{e.type}</div>
              <pre className="event-data">
                {truncated && !isOpen ? dataStr.slice(0, 140) + '…' : dataStr}
              </pre>
              {truncated && (
                <button
                  className="ghost"
                  onClick={() => setExpanded(x => ({ ...x, [e.id]: !x[e.id] }))}
                  aria-expanded={isOpen ? true : false}
                  style={{ padding: '2px 8px', fontSize: 11 }}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {data?.resume?.snapshot && (
        <section style={{ marginTop: '1.25rem' }}>
          <button
            className="ghost"
            onClick={() => setShowResume(s => !s)}
            aria-expanded={showResume}
          >
            {showResume ? '▾' : '▸'} {t('sessions.resume', 'Resume snapshot')}
            {data.resume.consumed ? ' · consumed' : ''}
            {data.resume.event_count != null ? ` · ${data.resume.event_count} events` : ''}
          </button>
          {showResume && (
            <pre className="resume-snapshot">{data.resume.snapshot}</pre>
          )}
        </section>
      )}
    </>
  );
}
