import { useInfiniteQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { Skeleton } from '../components/Skeleton';
import { CopyButton } from '../features/sessions/CopyButton';
import { EventTooltip, categoryOf } from '../features/sessions/EventTooltip';
import { useSentinel } from '../features/sessions/hooks';
import { resumeCommand } from '../features/sessions/resumeCommand';
import {
  getSessionEvents,
  type SessionDetailPage as DetailPage,
  type SessionEnrichment,
  type SessionEvent,
  type SessionMeta,
} from '../features/sessions/sessionsApi';
import { formatDuration } from '../features/sessions/time';
import '../features/sessions/sessions.css';

const PREVIEW_CHARS = 160;
const BREAKDOWN_TOP = 8;

function projectName(dir: string | null | undefined) {
  if (!dir) return '—';
  return dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir;
}

/** One-line explanation for an event type; '' when no translation exists. */
function eventDesc(t: TFunction, type: string): string {
  const key = `sessions.event_desc.${type}`;
  const v = t(key, { defaultValue: '' });
  return v === key ? '' : v;
}

export function SessionDetailPage() {
  const { t } = useTranslation();
  const { hash = '', sessionId = '' } = useParams();

  const q = useInfiniteQuery({
    queryKey: ['session-events', hash, sessionId],
    queryFn: ({ pageParam, signal }) => getSessionEvents(hash, sessionId, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last: DetailPage) =>
      last.hasMore ? (last.events.at(-1)?.id ?? undefined) : undefined,
    staleTime: 30_000,
  });

  const head = q.data?.pages[0];
  const events = useMemo(() => q.data?.pages.flatMap((p) => p.events) ?? [], [q.data]);
  const sentinel = useSentinel<HTMLDivElement>(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, Boolean(q.hasNextPage));

  if (q.isError) {
    return (
      <div className="empty-state" role="alert">
        <h3>{t('sessions.detail_error', 'Could not load session')}</h3>
        <p className="muted">{q.error.message}</p>
        <p>
          <Link to="/sessions">← {t('nav.sessions', 'Sessions')}</Link>
        </p>
      </div>
    );
  }

  const meta = head?.meta ?? null;
  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('sessions.detail_title', 'Session detail')}</h1>
          <nav className="subtitle" aria-label={t('common.breadcrumb', 'Breadcrumb')}>
            <Link to="/sessions">{t('nav.sessions', 'Sessions')}</Link>{' '}
            <span className="muted" aria-hidden>
              /
            </span>{' '}
            <span className="mono">{sessionId.slice(0, 12)}</span>
          </nav>
        </div>
        <div className="actions">
          {meta && (
            <CopyButton
              className="ghost"
              text={() => buildHandoff(meta, head?.enrich ?? null)}
              title={t(
                'task.copy_context_hint',
                'Copies session context as markdown — paste into a fresh agent session.',
              )}
              label={t('task.copy_context', 'Copy context')}
            />
          )}
          {head && (
            <CopyButton
              className="ghost"
              text={resumeCommand(sessionId, head.repoPath ?? meta?.project_dir, head.provider)}
              label={t('task.resume', 'Open in CLI')}
            />
          )}
          <Link to="/sessions" className="button ghost">
            ← {t('nav.sessions', 'Sessions')}
          </Link>
        </div>
      </div>

      {!head ? (
        <DetailSkeleton />
      ) : (
        <>
          <section className="session-detail-meta">
            <div>
              <div className="k">{t('sessions.project', 'Project')}</div>
              <div className="v" title={meta?.project_dir ?? undefined}>
                {projectName(meta?.project_dir)}
              </div>
            </div>
            {head.taskCode && (
              <div>
                <div className="k">{t('sessions.task', 'Task')}</div>
                <div className="v mono">{head.taskCode}</div>
              </div>
            )}
            <div>
              <div className="k">{t('sessions.session_id', 'Session ID')}</div>
              <div className="v mono">{sessionId}</div>
            </div>
            <div>
              <div className="k">{t('sessions.db_hash', 'DB hash')}</div>
              <div className="v mono">{hash}</div>
            </div>
          </section>

          {head.enrich && <SummaryPane enrich={head.enrich} />}

          <div className="session-stats">
            <Kpi label={t('sessions.total_events', 'Events')} value={head.totalEvents} />
            <Kpi
              label={t('sessions.duration', 'Duration')}
              value={formatDuration(t, head.firstEventAt, head.lastEventAt)}
            />
            <Kpi label={t('sessions.types', 'Types')} value={head.typeCounts.length} />
            <Kpi label={t('sessions.compacts', 'Compacts')} value={meta?.compact_count ?? 0} />
          </div>

          <Breakdown typeCounts={head.typeCounts} />

          <h2 className="section-title">{t('sessions.timeline', 'Event timeline')}</h2>
          <ol className="event-timeline">
            {events.length === 0 && (
              <li className="muted event-empty">{t('sessions.no_events', 'No events')}</li>
            )}
            {events.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ol>
          <div ref={sentinel} className="session-list-foot">
            {q.isFetchingNextPage ? (
              <Skeleton width="100%" height={36} />
            ) : q.hasNextPage ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  void q.fetchNextPage();
                }}
              >
                {t('sessions.load_more', 'Load more')} ·{' '}
                <span className="tabular">
                  {events.length.toLocaleString()} / {head.totalEvents.toLocaleString()}
                </span>
              </button>
            ) : null}
          </div>

          {head.resume?.snapshot && <ResumeSnapshot resume={head.resume} />}
        </>
      )}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="session-kpi">
      <div className="session-kpi-value tabular">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="session-kpi-label">{label}</div>
    </div>
  );
}

function Breakdown({ typeCounts }: { typeCounts: DetailPage['typeCounts'] }) {
  const { t } = useTranslation();
  if (typeCounts.length === 0) return null;
  const top = typeCounts.slice(0, BREAKDOWN_TOP);
  const totalTop = top.reduce((n, x) => n + x.count, 0) || 1;
  return (
    <section aria-labelledby="breakdown-h">
      <h2 id="breakdown-h" className="section-title">
        {t('sessions.breakdown', 'Event breakdown')}
      </h2>
      <div className="ratio-bar">
        {top.map(({ type, count }) => (
          <EventTooltip
            key={type}
            type={type}
            description={eventDesc(t, type)}
            triggerClassName={`ratio-seg cat-${categoryOf(type)}`}
            triggerStyle={{ width: `${(count * 100) / totalTop}%` }}
          >
            <span className="sr-only">
              {type}: {count}
            </span>
          </EventTooltip>
        ))}
      </div>
      <div className="type-tags">
        {typeCounts.map(({ type, count }) => (
          <EventTooltip key={type} type={type} description={eventDesc(t, type)}>
            <span className={`type-tag cat-${categoryOf(type)}`}>
              {type}
              <span className="n tabular">{count}</span>
            </span>
          </EventTooltip>
        ))}
      </div>
    </section>
  );
}

const EventRow = memo(function EventRow({ e }: { e: SessionEvent }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const data = e.data ?? '';
  const truncated = data.length > PREVIEW_CHARS;
  const prio = Math.min(4, Math.max(0, e.priority ?? 0));
  return (
    <li className={`event-row prio-${prio}`}>
      <time className="event-time mono" dateTime={e.created_at ?? undefined}>
        {(e.created_at ?? '').replace('T', ' ').slice(0, 19)}
      </time>
      <EventTooltip type={e.type} description={eventDesc(t, e.type)}>
        <span className={`event-type-badge cat-${categoryOf(e.type)}`}>{e.type}</span>
      </EventTooltip>
      <pre className="event-data">
        {truncated && !open ? `${data.slice(0, PREVIEW_CHARS)}…` : data}
      </pre>
      {truncated && (
        <button
          type="button"
          className="ghost sm event-toggle"
          onClick={() => {
            setOpen((v) => !v);
          }}
          aria-expanded={open}
        >
          {open ? t('common.less', 'Less') : t('common.more', 'More')}
        </button>
      )}
    </li>
  );
});

function ResumeSnapshot({ resume }: { resume: NonNullable<DetailPage['resume']> }) {
  const { t } = useTranslation();
  return (
    <details className="resume-details">
      <summary>
        {t('sessions.resume', 'Resume snapshot')}
        {resume.consumed ? ` · ${t('sessions.consumed', 'consumed')}` : ''}
        {` · ${t('sessions.n_events', '{{n}} events', { n: resume.event_count })}`}
      </summary>
      <pre className="resume-snapshot">{resume.snapshot}</pre>
    </details>
  );
}

function ExpandableText({ text, limit = 140 }: { text: string; limit?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const overflow = text.length > limit;
  return (
    <span className="summary-role-wrap">
      <span className="summary-role">
        {!overflow || open ? text : `${text.slice(0, limit).trimEnd()}…`}
      </span>
      {overflow && (
        <button
          type="button"
          className="linkish"
          onClick={() => {
            setOpen((v) => !v);
          }}
          aria-expanded={open}
        >
          {open ? t('common.less', 'Less') : t('common.more', 'More')}
        </button>
      )}
    </span>
  );
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;

function SummaryPane({ enrich }: { enrich: SessionEnrichment }) {
  const { t } = useTranslation();
  const hasFacts =
    enrich.intent !== null ||
    enrich.role !== null ||
    enrich.topFiles.length > 0 ||
    enrich.planFiles.length > 0;
  if (!enrich.firstPrompt && !hasFacts) return null;

  return (
    <section className="session-summary" aria-labelledby="summary-h">
      <h2 id="summary-h" className="section-title">
        {t('sessions.summary', 'Summary')}
      </h2>
      {enrich.firstPrompt && <blockquote className="summary-quote">{enrich.firstPrompt}</blockquote>}
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
              <dd>
                <ExpandableText text={enrich.role} />
              </dd>
            </>
          )}
          {enrich.planFiles.length > 0 && (
            <>
              <dt>{t('sessions.plan_files', 'Plan files')}</dt>
              <dd className="summary-chip-row">
                {enrich.planFiles.map((p) => (
                  <span key={p} className="session-tag plan mono" title={p}>
                    {baseName(p)}
                  </span>
                ))}
              </dd>
            </>
          )}
          {enrich.topFiles.length > 0 && (
            <>
              <dt>{t('sessions.top_files', 'Top-touched files')}</dt>
              <dd className="summary-chip-row">
                {enrich.topFiles.map((f) => (
                  <span key={f.path} className="session-tag file mono" title={f.path}>
                    {baseName(f.path)}
                    <span className="n tabular">×{f.count}</span>
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

function buildHandoff(meta: SessionMeta, enrich: SessionEnrichment | null): string {
  const lines = [
    `# Session handoff — ${meta.session_id.slice(0, 12)}`,
    '',
    `**Project**: ${meta.project_dir ?? '—'}`,
    `**Started**: ${meta.started_at ?? '—'}`,
    `**Last event**: ${meta.last_event_at ?? '—'}`,
    `**Events**: ${meta.event_count} (${meta.compact_count} compactions)`,
  ];
  if (enrich?.intent) lines.push(`**Intent**: ${enrich.intent}`);
  if (enrich?.role) lines.push(`**Role**: ${enrich.role}`);
  lines.push('');
  if (enrich?.firstPrompt) lines.push('## First prompt', enrich.firstPrompt, '');
  if (enrich?.topFiles.length) {
    lines.push('## Top-touched files', ...enrich.topFiles.map((f) => `- \`${f.path}\` (×${f.count})`), '');
  }
  if (enrich?.planFiles.length) {
    lines.push('## Plan files', ...enrich.planFiles.map((p) => `- \`${p}\``), '');
  }
  lines.push(
    '---',
    'Please pick up from here. If the session is resumable via the CLI, prefer that; otherwise continue from this context.',
  );
  return lines.join('\n');
}

function DetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('common.loading', 'Loading…')}>
      <div className="session-detail-meta" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i}>
            <Skeleton width={80} height={10} />
            <Skeleton width="70%" height={16} />
          </div>
        ))}
      </div>
      <div className="session-stats" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="session-kpi">
            <Skeleton width={64} height={26} />
            <Skeleton width={80} height={11} />
          </div>
        ))}
      </div>
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} width="100%" height={34} className="event-skeleton" />
      ))}
    </div>
  );
}
