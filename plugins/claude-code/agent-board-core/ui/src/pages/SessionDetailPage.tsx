import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api';
import { EventTooltip, categoryOf } from '../features/sessions/EventTooltip';

function projectName(dir: string | null | undefined) {
  if (!dir) return '—';
  return dir.split(/[\\/]/).filter(Boolean).slice(-1)[0] || dir;
}

/**
 * One-line explanation for a given event type (Claude Code hook/session event
 * names + context-mode hook sub-types). Falls back to '' when unknown so the
 * tooltip just shows the raw type string. Translations live under
 * `sessions.event_desc.<type>` in each locale.
 */
function eventDesc(t: (k: string, opts?: any) => string, type: string): string {
  if (!type) return '';
  const key = `sessions.event_desc.${type}`;
  const v = t(key, { defaultValue: '' });
  if (!v || v === key) return '';
  return v;
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
      <p className="muted">{String((q.error)?.message || '')}</p>
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
          {meta && (
            <CopySessionContextButton meta={meta} enrich={data?.enrich ?? null} />
          )}
          {meta?.session_id && (
            <ResumeCliButton sessionId={meta.session_id} repoPath={meta.project_dir} provider={data?.provider} />
          )}
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

      {data?.enrich && (
        <SummaryPane enrich={data.enrich} />
      )}

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
            {topTypes.map(([type, n]) => (
              <EventTooltip
                key={type}
                type={type}
                description={eventDesc(t, type)}
                triggerClassName={`ratio-seg cat-${categoryOf(type)}`}
                triggerStyle={{ width: `${(n * 100) / totalTop}%` }}
              >
                <span className="sr-only">{type}: {n}</span>
              </EventTooltip>
            ))}
          </div>
          <div className="type-tags">
            {typeCounts.map(([type, n]) => (
              <EventTooltip key={type} type={type} description={eventDesc(t, type)}>
                <span className={`type-tag cat-${categoryOf(type)}`}>{type}<span className="n">{n}</span></span>
              </EventTooltip>
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
              <EventTooltip type={e.type} description={eventDesc(t, e.type)}>
                <div className="event-type-badge">{e.type}</div>
              </EventTooltip>
              <pre className="event-data">
                {truncated && !isOpen ? dataStr.slice(0, 140) + '…' : dataStr}
              </pre>
              {truncated && (
                <button
                  className="ghost"
                  onClick={() => { setExpanded(x => ({ ...x, [e.id]: !x[e.id] })); }}
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
            onClick={() => { setShowResume(s => !s); }}
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

function ExpandableRole({ text }: { text: string }) {
  const { t } = useTranslation();
  const LIMIT = 140;
  const [open, setOpen] = useState(false);
  const overflow = text.length > LIMIT;
  const body = !overflow || open ? text : text.slice(0, LIMIT).trimEnd() + '…';
  return (
    <span className="summary-role-wrap">
      <span className="summary-role">{body}</span>
      {overflow && (
        <button
          type="button"
          className="linkish"
          onClick={() => { setOpen(v => !v); }}
          aria-expanded={open}
        >
          {open ? t('common.less', 'see less') : t('common.more', 'see more…')}
        </button>
      )}
    </span>
  );
}

function SummaryPane({ enrich }: {
  enrich: {
    firstPrompt: string | null;
    intent: string | null;
    role: string | null;
    topFiles: { path: string; count: number }[];
    planFiles: string[];
  };
}) {
  const { t } = useTranslation();
  const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-1)[0] || p;
  const hasFacts =
    enrich.intent || enrich.role ||
    (enrich.topFiles?.length ?? 0) > 0 ||
    (enrich.planFiles?.length ?? 0) > 0;
  if (!enrich.firstPrompt && !hasFacts) return null;

  return (
    <section className="session-summary" aria-labelledby="summary-h">
      <div className="summary-head">
        <span className="dot" aria-hidden />
        <h3 id="summary-h">{t('sessions.summary', 'Summary')}</h3>
      </div>

      {enrich.firstPrompt && (
        <blockquote className="summary-quote">
          {enrich.firstPrompt}
        </blockquote>
      )}

      {hasFacts && (
        <dl className="summary-facts">
          {enrich.intent && (
            <>
              <dt>{t('sessions.intent', 'Intent')}</dt>
              <dd>
                <span className={`session-tag intent intent-${enrich.intent}`}>
                  {enrich.intent}
                </span>
              </dd>
            </>
          )}
          {enrich.role && (
            <>
              <dt>{t('sessions.role', 'Role')}</dt>
              <dd><ExpandableRole text={enrich.role} /></dd>
            </>
          )}
          {enrich.planFiles?.length > 0 && (
            <>
              <dt>{t('sessions.plan_files', 'Plan files')}</dt>
              <dd className="summary-chip-row">
                {enrich.planFiles.map(p => (
                  <span key={p} className="session-tag plan mono" title={p}>
                    {baseName(p)}
                  </span>
                ))}
              </dd>
            </>
          )}
          {enrich.topFiles?.length > 0 && (
            <>
              <dt>{t('sessions.top_files', 'Top-touched files')}</dt>
              <dd className="summary-chip-row">
                {enrich.topFiles.map(f => (
                  <span key={f.path} className="session-tag file mono" title={`${f.path} (×${f.count})`}>
                    {baseName(f.path)}
                    <span className="n">×{f.count}</span>
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

function ResumeCliButton({
  sessionId, repoPath, provider = 'claude',
}: { sessionId: string; repoPath: string | null | undefined; provider?: 'claude' | 'github_copilot' | 'codex' | null }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // PowerShell 5 doesn't support `&&`; `;` works in bash / PS5+.
  const bin = provider === 'codex' ? 'codex resume' : 'claude --resume';
  const cmd = repoPath
    ? `cd "${repoPath}"; ${bin} ${sessionId}`
    : `${bin} ${sessionId}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1800);
    } catch { /* clipboard blocked */ }
  }
  return (
    <button
      type="button"
      className="ghost"
      onClick={copy}
      title={cmd}
    >
      {copied ? t('common.copied', 'Copied ✓') : `⏎ ${t('task.resume', 'Open in CLI')}`}
    </button>
  );
}

function CopySessionContextButton({
  meta, enrich,
}: {
  meta: { session_id: string; project_dir: string | null; started_at: string; last_event_at: string; event_count: number; compact_count: number };
  enrich: {
    firstPrompt: string | null;
    intent: string | null;
    role: string | null;
    topFiles: { path: string; count: number }[];
    planFiles: string[];
  } | null;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function buildContext(): string {
    const lines: string[] = [];
    lines.push(`# Session handoff — ${meta.session_id.slice(0, 12)}`);
    lines.push('');
    lines.push(`**Project**: ${meta.project_dir ?? '—'}`);
    lines.push(`**Started**: ${meta.started_at}`);
    lines.push(`**Last event**: ${meta.last_event_at}`);
    lines.push(`**Events**: ${meta.event_count} (${meta.compact_count} compactions)`);
    if (enrich?.intent) lines.push(`**Intent**: ${enrich.intent}`);
    if (enrich?.role) lines.push(`**Role**: ${enrich.role}`);
    lines.push('');
    if (enrich?.firstPrompt) {
      lines.push('## First prompt');
      lines.push(enrich.firstPrompt);
      lines.push('');
    }
    if (enrich?.topFiles?.length) {
      lines.push('## Top-touched files');
      for (const f of enrich.topFiles) lines.push(`- \`${f.path}\` (×${f.count})`);
      lines.push('');
    }
    if (enrich?.planFiles?.length) {
      lines.push('## Plan files');
      for (const p of enrich.planFiles) lines.push(`- \`${p}\``);
      lines.push('');
    }
    lines.push('---');
    lines.push('Please pick up from here. If the session is resumable via the CLI, prefer that; otherwise continue from this context.');
    return lines.join('\n');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildContext());
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1800);
    } catch { /* clipboard blocked */ }
  }

  return (
    <button
      type="button"
      className="ghost"
      onClick={copy}
      title={t('task.copy_context_hint', 'Copies session context as markdown — paste into a fresh claude session.')}
    >
      {copied ? t('common.copied', 'Copied ✓') : `⏎ ${t('task.copy_context', 'Copy context')}`}
    </button>
  );
}
