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
  listTasks: () => call<{ tasks: any[] }>('GET', '/api/tasks'),
  createTask: (body: { title: string; description?: string }) =>
    call<{ task: any; runId?: string }>('POST', '/api/tasks', body),
  getTask: (code: string) =>
    call<{ task: any; comments: any[]; runs: any[] }>('GET', `/api/tasks/${encodeURIComponent(code)}`),
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
  taskCost: (code: string) => call<any>('GET', `/api/tasks/${encodeURIComponent(code)}/cost`),
  deleteTask: (code: string) =>
    call<{ ok: boolean; cancelled_runs: number }>('DELETE', `/api/tasks/${encodeURIComponent(code)}`),
  projectCostsTotal: (code: string) =>
    call<any>('GET', `/api/projects/${encodeURIComponent(code)}/costs/total`),
};
