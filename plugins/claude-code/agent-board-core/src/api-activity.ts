// Activity REST + SSE feed. Drives the "live working state" board.
// Reads agent_activity (append-only event log); subscribes to agentboardBus
// for real-time fan-out so the UI sees phase/tool events as they happen.

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { EventBus } from './event-bus.ts';
import { agentboardBus } from './event-bus.ts';
import { listActivity, listActivityForTask } from './phase-repo.ts';
import { getActiveDb } from './project-registry.ts';

// ── AgentActivityEvent discriminated union ───────────────────────────────────

export type AgentActivityKind =
  | 'phase:advanced'
  | 'phase:exit'
  | 'tool:invoked'
  | 'tool:blocked'
  | 'debt:recorded'
  | 'debt:resolved'
  | 'run:started'
  | 'run:finished'
  | 'skill:used'
  | 'skill:missed';

export interface AgentActivityEvent {
  id: string;
  run_id: string;
  task_id: string;
  kind: AgentActivityKind;
  payload: Record<string, unknown>;
  at: string;
}

/** Structural supertype accepted by emitActivity — covers ActivityRow from phase-repo. */
export interface ActivityLike {
  id: string;
  run_id: string;
  task_id: string;
  kind: string;
  payload: Record<string, unknown>;
  at: string;
}

// ── EventBus typing ──────────────────────────────────────────────────────────

// Cast the shared bus to an activity-scoped view. The constraint
// Record<string, unknown[]> is satisfied via the cast below.
const bus = agentboardBus as EventBus<Record<'activity', [AgentActivityEvent]>>;

const ACTIVITY_EVENT = 'activity' as const;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Emit a typed activity event. Persistence is the caller's responsibility.
 * We only fan out to the bus here.
 */
export function emitActivity(_db: unknown, evt: ActivityLike): void {
  // kind is trusted to be a valid AgentActivityKind at call sites.
  bus.emit(ACTIVITY_EVENT, evt as AgentActivityEvent);
}

export async function handleActivity(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean | null | undefined> {
  const p = url.pathname;

  // GET /api/runs/:id/events  → SSE stream
  const sseMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(p);
  if (sseMatch && req.method === 'GET') {
    const run_id = String(sseMatch[1]);
    const since = url.searchParams.get('since') ?? undefined;
    serveSse(req, res, run_id, since);
    return true;
  }

  // GET /api/runs/:id/activity  → JSON history
  const histMatch = /^\/api\/runs\/([^/]+)\/activity$/.exec(p);
  if (histMatch && req.method === 'GET') {
    const run_id = String(histMatch[1]);
    const active = await getActiveDb();
    if (!active) {
      res.writeHead(404);
      res.end();
      return;
    }
    const rows = listActivity(active.db, run_id);
    const buf = Buffer.from(JSON.stringify({ activity: rows }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': buf.length });
    res.end(buf);
    return true;
  }

  // GET /api/tasks/:id/activity?limit=N  → recent activity for a task card
  const taskMatch = /^\/api\/tasks\/([^/]+)\/activity$/.exec(p);
  if (taskMatch && req.method === 'GET') {
    const task_id = String(taskMatch[1]);
    const limit = Number(url.searchParams.get('limit') ?? '20');
    const active = await getActiveDb();
    if (!active) {
      res.writeHead(404);
      res.end();
      return;
    }
    const rows = listActivityForTask(active.db, task_id, limit);
    const buf = Buffer.from(JSON.stringify({ activity: rows }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': buf.length });
    res.end(buf);
    return true;
  }

  return null;
}

// ── SSE internals ────────────────────────────────────────────────────────────

function sendSse(res: ServerResponse, event: string, data: unknown): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

function serveSse(
  req: IncomingMessage,
  res: ServerResponse,
  run_id: string,
  since: string | undefined,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`: agentboard SSE ready (run=${run_id})\n\n`);

  // Replay history so reconnects don't lose state.
  void (async (): Promise<void> => {
    try {
      const active = await getActiveDb();
      if (!active) return;
      const rows = listActivity(active.db, run_id, since) as AgentActivityEvent[];
      for (const r of rows) sendSse(res, 'activity', r);
    } catch (e) {
      console.error('[sse] replay failed', (e as Error).message);
    }
  })();

  const onActivity = (evt: AgentActivityEvent): void => {
    if (evt.run_id !== run_id) return;
    try {
      sendSse(res, 'activity', evt);
    } catch {
      /* client gone */
    }
  };
  bus.on(ACTIVITY_EVENT, onActivity);

  const hb = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(hb);
    }
  }, 25_000);

  const cleanup = (): void => {
    clearInterval(hb);
    bus.off(ACTIVITY_EVENT, onActivity);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
}
