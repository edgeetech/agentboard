import { call } from '../../api';

export type SessionProvider = 'claude' | 'github_copilot' | 'codex';
export type SessionSourceFilter = 'all' | 'agentboard' | 'cli';

export interface SessionListItem {
  dbHash: string;
  id: string;
  projectDir: string | null;
  startedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
  compactCount: number;
  firstPrompt: string | null;
  intent: string | null;
  role: string | null;
  source: 'agentboard' | 'cli';
  taskCode: string | null;
  projectCode: string | null;
  provider: SessionProvider;
  repoPath: string | null;
}

export interface SessionPage {
  items: SessionListItem[];
  total: number;
  nextOffset: number | null;
  counts: Record<SessionSourceFilter, number>;
  stats: { sessions: number; events: number; avgDurationMin: number; dbs: number };
  indexing: boolean;
  progress: { indexed: number; total: number };
  indexedAt: string | null;
  dirs: string[];
}

export interface SessionEvent {
  id: number;
  type: string;
  category: string | null;
  priority: number | null;
  data: string | null;
  source_hook: string | null;
  created_at: string | null;
}

export interface SessionMeta {
  session_id: string;
  project_dir: string | null;
  started_at: string | null;
  last_event_at: string | null;
  event_count: number;
  compact_count: number;
}

export interface SessionEnrichment {
  firstPrompt: string | null;
  intent: string | null;
  role: string | null;
  topFiles: { path: string; count: number }[];
  planFiles: string[];
}

export interface SessionDetailPage {
  hash: string;
  sessionId: string;
  meta: SessionMeta | null;
  events: SessionEvent[];
  hasMore: boolean;
  totalEvents: number;
  typeCounts: { type: string; count: number }[];
  firstEventAt: string | null;
  lastEventAt: string | null;
  resume: { snapshot: string | null; event_count: number; consumed: number } | null;
  enrich: SessionEnrichment | null;
  provider: SessionProvider;
  taskCode: string | null;
  projectCode: string | null;
  repoPath: string | null;
}

export const SESSION_PAGE_SIZE = 50;
export const EVENT_PAGE_SIZE = 300;

export function listSessions(
  params: { q: string; source: SessionSourceFilter; offset: number },
  signal?: AbortSignal,
): Promise<SessionPage> {
  const qs = new URLSearchParams({
    source: params.source,
    offset: String(params.offset),
    limit: String(SESSION_PAGE_SIZE),
  });
  if (params.q !== '') qs.set('q', params.q);
  return call<SessionPage>('GET', `/api/sessions?${qs.toString()}`, undefined, { signal });
}

export function getSessionEvents(
  hash: string,
  sessionId: string,
  after: number,
  signal?: AbortSignal,
): Promise<SessionDetailPage> {
  const qs = new URLSearchParams({ after: String(after), limit: String(EVENT_PAGE_SIZE) });
  return call<SessionDetailPage>(
    'GET',
    `/api/sessions/${encodeURIComponent(hash)}/events/${encodeURIComponent(sessionId)}?${qs.toString()}`,
    undefined,
    { signal },
  );
}
