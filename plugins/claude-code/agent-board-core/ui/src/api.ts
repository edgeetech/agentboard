const token = () => window.__AGENTBOARD_TOKEN || '';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) throw new Error(json?.error || text || `HTTP ${res.status}`);
  return json as T;
}
function safeJson(s: string) { try { return JSON.parse(s); } catch { return null; } }

export const api = {
  alive: () => fetch('/alive').then(r => r.json()),
  healthz: () => call<any>('GET', '/healthz'),
  listProjects: () => call<{ projects: any[] }>('GET', '/api/projects/list'),
  activeProject: () => call<{ project: any | null }>('GET', '/api/projects/active'),
  suggestCode: (name: string) =>
    call<{ code: string }>('GET', `/api/projects/suggest-code?name=${encodeURIComponent(name)}`),
  createProject: (body: {
    code: string; name: string; description?: string;
    workflow_type: 'WF1' | 'WF2'; repo_path: string;
  }) => call<{ project: any }>('POST', '/api/projects', body),
  listTasks: (search?: string) => call<{ tasks: any[] }>('GET', search ? `/api/tasks?search=${encodeURIComponent(search)}` : '/api/tasks'),
  createTask: (body: { title: string; description?: string }) =>
    call<{ task: any; runId?: string }>('POST', '/api/tasks', body),
  getTask: (code: string) =>
    call<{ task: any; project: any; comments: any[]; runs: any[] }>('GET', `/api/tasks/${encodeURIComponent(code)}`),
  dispatch: (code: string, role: 'pm' | 'worker' | 'reviewer') =>
    call<{ runId: string }>('POST', `/api/tasks/${encodeURIComponent(code)}/dispatch`, { role }),
  cancelRun: (code: string) =>
    call<{ ok: boolean; runId: string }>('POST', `/api/tasks/${encodeURIComponent(code)}/cancel-run`),
  retryFromWorker: (code: string) =>
    call<{ ok: boolean; runId?: string }>('POST', `/api/tasks/${encodeURIComponent(code)}/retry-from-worker`),
  approve: (code: string) =>
    call<any>('POST', `/api/tasks/${encodeURIComponent(code)}/transition`, {
      to_status: 'done', to_assignee: 'human', by_role: 'human',
    }),
  reject: (code: string, reject_comment: string) =>
    call<any>('POST', `/api/tasks/${encodeURIComponent(code)}/transition`, {
      to_status: 'agent_working', to_assignee: 'worker', by_role: 'human', reject_comment,
    }),
  transition: (code: string, payload: { to_status: string; to_assignee: string; by_role: string; reject_comment?: string }) =>
    call<any>('POST', `/api/tasks/${encodeURIComponent(code)}/transition`, payload),
  taskCost: (code: string) => call<any>('GET', `/api/tasks/${encodeURIComponent(code)}/cost`),
  sessions: () => call<{ dir: string; dbs: Array<{
    hash: string; size: string; sizeBytes: number;
    sessions: Array<{
      id: string; projectDir: string | null;
      startedAt: string; lastEventAt: string;
      eventCount: number; compactCount: number;
      firstPrompt?: string | null;
      intent?: string | null;
      role?: string | null;
      topFiles?: Array<{ path: string; count: number }>;
      planFiles?: string[];
    }>;
  }>; error?: string }>('GET', '/api/sessions'),
  prompt: (kind: 'role' | 'skill', id: string) =>
    call<{ kind: string; id: string; path?: string; content?: string; error?: string }>(
      'GET', `/api/prompts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
    ),
  sessionEvents: (hash: string, sessionId: string) => call<{
    hash: string; sessionId: string;
    meta: { session_id: string; project_dir: string | null; started_at: string; last_event_at: string; event_count: number; compact_count: number } | null;
    events: Array<{ id: number; type: string; category: string | null; priority: number | null; data: string | null; source_hook: string | null; created_at: string }>;
    resume: { snapshot: string | null; event_count: number | null; consumed: number | null } | null;
    enrich?: {
      firstPrompt: string | null;
      intent: string | null;
      role: string | null;
      topFiles: Array<{ path: string; count: number }>;
      planFiles: string[];
    } | null;
    error?: string;
  }>('GET', `/api/sessions/${encodeURIComponent(hash)}/events/${encodeURIComponent(sessionId)}`),
  deleteTask: (code: string) =>
    call<{ ok: boolean; cancelled_runs: number }>('DELETE', `/api/tasks/${encodeURIComponent(code)}`),
  projectCostsTotal: (code: string) =>
    call<any>('GET', `/api/projects/${encodeURIComponent(code)}/costs/total`),
  updateProject: (code: string, patch: Record<string, unknown> & { version: number }) =>
    call<{ ok: boolean; project: any }>('PATCH', `/api/projects/${encodeURIComponent(code)}`, patch),
  deleteProject: (code: string) =>
    call<{ ok: boolean; cancelled_runs: number; trashed_path: string }>('DELETE', `/api/projects/${encodeURIComponent(code)}`),
};
