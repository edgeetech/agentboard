import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { SearchIcon } from '../components/SearchIcon';
import { Skeleton } from '../components/Skeleton';
import { CopyButton } from '../features/sessions/CopyButton';
import { useDebouncedValue, useSentinel } from '../features/sessions/hooks';
import { resumeCommand } from '../features/sessions/resumeCommand';
import {
  listSessions,
  type SessionListItem,
  type SessionPage,
  type SessionSourceFilter,
} from '../features/sessions/sessionsApi';
import { durationMinutes, timeAgo } from '../features/sessions/time';
import '../features/sessions/sessions.css';

const SOURCES: SessionSourceFilter[] = ['all', 'agentboard', 'cli'];
const INDEXING_POLL_MS = 1500;

export function SessionsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<SessionSourceFilter>('all');
  const q = useDebouncedValue(search.trim(), 250);

  const query = useInfiniteQuery({
    queryKey: ['sessions', q, source],
    queryFn: ({ pageParam, signal }) => listSessions({ q, source, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last: SessionPage) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
    // Only poll while the server is still indexing; afterwards the list is
    // refreshed on focus/navigation, not on a timer.
    refetchInterval: (qry) => (qry.state.data?.pages[0]?.indexing ? INDEXING_POLL_MS : false),
    staleTime: 10_000,
  });

  const pages = query.data?.pages;
  const head = pages?.[0];
  const items = useMemo(() => pages?.flatMap((p) => p.items) ?? [], [pages]);
  const sentinel = useSentinel<HTMLDivElement>(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, Boolean(query.hasNextPage));

  const sourceLabel = (f: SessionSourceFilter) =>
    f === 'all'
      ? t('sessions.source_all', 'All')
      : f === 'agentboard'
        ? t('sessions.source_agentboard', 'AgentBoard')
        : t('sessions.source_cli', 'CLI / Other');

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('sessions.title', 'Sessions')}</h1>
          <span className="subtitle">
            {t('sessions.subtitle', 'Every recorded AI coding session, newest first.')}
          </span>
        </div>
        <div className="actions">
          <div
            className="segmented"
            role="radiogroup"
            aria-label={t('sessions.filter_source', 'Filter by source')}
          >
            {SOURCES.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={source === f}
                className={source === f ? 'active' : undefined}
                onClick={() => {
                  setSource(f);
                }}
              >
                {sourceLabel(f)}
                <span className="count tabular">{head ? head.counts[f] : '·'}</span>
              </button>
            ))}
          </div>
          <label className="search-bar wide">
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder={t('sessions.search', 'Search prompt, project, task or id…')}
              aria-label={t('sessions.search_label', 'Search sessions')}
              autoComplete="off"
              spellCheck={false}
            />
            {head && (
              <span className="search-count tabular" aria-live="polite">
                {head.total.toLocaleString()}
              </span>
            )}
          </label>
        </div>
      </div>

      {head?.indexing && <IndexingBanner progress={head.progress} />}

      {query.isError ? (
        <div className="empty-state" role="alert">
          <h3>{t('sessions.error_title', 'Could not read sessions')}</h3>
          <p className="muted">{query.error.message}</p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      ) : !head ? (
        <SessionsSkeleton />
      ) : head.stats.sessions === 0 && !head.indexing ? (
        <div className="empty-state">
          <h3>{t('sessions.empty_title', 'No sessions recorded yet')}</h3>
          <p className="muted">
            {t(
              'sessions.empty_body',
              'Sessions appear here once the AgentBoard session hooks record a Claude Code, Codex or Copilot session. Looked in:',
            )}
          </p>
          <ul className="session-dirs mono">
            {head.dirs.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className="session-stats">
            <Stat label={t('sessions.total_sessions', 'Sessions')} value={head.stats.sessions} />
            <Stat label={t('sessions.total_events', 'Events')} value={head.stats.events} />
            <Stat
              label={t('sessions.avg_duration', 'Avg duration')}
              value={t('sessions.dur_m', '{{m}}m', { m: head.stats.avgDurationMin })}
            />
            <Stat label={t('sessions.dbs', 'Databases')} value={head.stats.dbs} />
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              <h3>{t('sessions.no_matches', 'No matches')}</h3>
              <p className="muted">
                {t('sessions.no_matches_hint', 'No session matches')} <code>{q}</code>
              </p>
            </div>
          ) : (
            <ol
              className={`session-list${query.isPlaceholderData ? ' is-stale' : ''}`}
              aria-busy={query.isFetching}
            >
              {items.map((s) => (
                <SessionRow key={`${s.dbHash}:${s.id}`} s={s} />
              ))}
            </ol>
          )}

          <div ref={sentinel} className="session-list-foot">
            {query.isFetchingNextPage ? (
              <RowSkeletons count={3} />
            ) : query.hasNextPage ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  void query.fetchNextPage();
                }}
              >
                {t('sessions.load_more', 'Load more')} ·{' '}
                <span className="tabular">
                  {items.length.toLocaleString()} / {head.total.toLocaleString()}
                </span>
              </button>
            ) : items.length > 0 ? (
              <span className="muted">
                {t('sessions.end_of_list', 'All {{n}} sessions shown', {
                  n: items.length.toLocaleString(),
                })}
              </span>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

function IndexingBanner({ progress }: { progress: SessionPage['progress'] }) {
  const { t } = useTranslation();
  const pct = progress.total === 0 ? 0 : Math.round((progress.indexed / progress.total) * 100);
  return (
    <div className="session-indexing" role="status" aria-live="polite">
      <div className="session-indexing-text">
        {t('sessions.indexing', 'Indexing session databases in the background…')}
        <span className="tabular muted">
          {progress.indexed} / {progress.total}
        </span>
      </div>
      <div
        className="session-indexing-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="session-kpi">
      <div className="session-kpi-value tabular">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="session-kpi-label">{label}</div>
    </div>
  );
}

const SessionRow = memo(function SessionRow({ s }: { s: SessionListItem }) {
  const { t, i18n } = useTranslation();
  const dur = durationMinutes(s.startedAt, s.lastEventAt);
  const href = `/sessions/${encodeURIComponent(s.dbHash)}/${encodeURIComponent(s.id)}`;
  return (
    <li className="session-row">
      <div className="session-main">
        <div className="session-title">
          {s.source === 'agentboard' && (
            <span className="session-tag source agentboard">
              {s.taskCode ?? t('sessions.source_agentboard', 'AgentBoard')}
              {s.role ? ` · ${s.role}` : ''}
            </span>
          )}
          {s.intent && <span className={`session-tag intent intent-${s.intent}`}>{s.intent}</span>}
          <Link to={href} className="session-link oneline" title={s.firstPrompt ?? undefined}>
            {s.firstPrompt ?? (
              <span className="muted">{t('sessions.untitled', 'No prompt recorded')}</span>
            )}
          </Link>
        </div>
        <div className="session-sub mono oneline" title={s.projectDir ?? undefined}>
          {s.projectDir ?? '—'}
        </div>
        <div className="session-meta mono">
          <span>{s.id.slice(0, 12)}</span>
          <CopyButton
            className="linkish resume-inline"
            text={resumeCommand(s.id, s.repoPath ?? s.projectDir, s.provider)}
            label={t('task.resume', 'Open in CLI')}
          />
        </div>
      </div>
      <dl className="session-facts">
        <div>
          <dt>{t('sessions.started', 'Started')}</dt>
          <dd>
            <time dateTime={s.startedAt ?? undefined}>{timeAgo(s.startedAt, i18n.language)}</time>
          </dd>
        </div>
        <div>
          <dt>{t('sessions.duration', 'Duration')}</dt>
          <dd className="tabular">
            {dur === null ? '—' : t('sessions.dur_m', '{{m}}m', { m: dur })}
          </dd>
        </div>
        <div>
          <dt>{t('sessions.events', 'Events')}</dt>
          <dd className="tabular">{s.eventCount.toLocaleString()}</dd>
        </div>
      </dl>
    </li>
  );
});

function RowSkeletons({ count }: { count: number }) {
  return (
    <div className="session-list" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="session-row skeleton-row">
          <div className="session-main">
            <Skeleton width="62%" height={16} />
            <Skeleton width="38%" height={12} />
            <Skeleton width="22%" height={10} />
          </div>
          <div className="session-facts">
            <Skeleton width={56} height={28} />
            <Skeleton width={56} height={28} />
            <Skeleton width={56} height={28} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionsSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('common.loading', 'Loading…')}>
      <div className="session-stats" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="session-kpi">
            <Skeleton width={72} height={26} />
            <Skeleton width={96} height={11} />
          </div>
        ))}
      </div>
      <RowSkeletons count={8} />
    </div>
  );
}
