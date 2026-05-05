// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string also falls back to ''
const token = () => window.__AGENTBOARD_TOKEN || '';

// Per-tab project scope. Set by useProjectCode() on every project-scoped route
// mount. All task/run APIs prepend `/api/projects/${code}` when it's set.
// A module-level variable is per-tab because each browser tab has its own JS
// module instance. Unset (null) → fall back to the legacy active-DB routes.
let currentProjectCode: string | null = null;
export function setProjectCode(code: string | null) {
  currentProjectCode = code;
}
export function getProjectCode(): string | null {
  return currentProjectCode;
}

function taskBase(): string {
  return currentProjectCode
    ? `/api/projects/${encodeURIComponent(currentProjectCode)}/tasks`
    : '/api/tasks';
}

function boardBase(): string {
  return currentProjectCode
    ? `/api/projects/${encodeURIComponent(currentProjectCode)}/board`
    : '/api/board';
}

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
function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const api = {
  alive: () => fetch('/alive').then((r) => r.json()),
  healthz: () => call<any>('GET', '/healthz'),
  listProjects: () => call<{ projects: any[] }>('GET', '/api/projects/list'),
  activeProject: () => call<{ project: any | null }>('GET', '/api/projects/active'),
  selectActiveProject: (code: string) =>
    call<{ ok: boolean }>('POST', '/api/projects/active/select', { code }),
  suggestCode: (name: string) =>
    call<{ code: string }>('GET', `/api/projects/suggest-code?name=${encodeURIComponent(name)}`),
  createProject: (body: {
    code: string;
    name: string;
    description?: string;
    workflow_type: 'WF1' | 'WF2';
    repo_path: string;
  }) => call<{ project: any }>('POST', '/api/projects', body),
  listTasks: (search?: string) =>
    call<{ tasks: any[] }>(
      'GET',
      search ? `${taskBase()}?search=${encodeURIComponent(search)}` : taskBase(),
    ),
  createTask: (body: { title: string; description?: string; assignee_role?: string | null }) =>
    call<{ task: any }>('POST', taskBase(), body),
  getTask: (code: string) =>
    call<{ task: any; project: any; comments: any[]; file_paths: any[]; agent_runs: any[] }>(
      'GET',
      `${taskBase()}/${encodeURIComponent(code)}`,
    ),
  addFilePath: (code: string, file_path: string, label?: string) =>
    call<{ file_path: any }>('POST', `${taskBase()}/${encodeURIComponent(code)}/file-paths`, {
      file_path,
      label,
    }),
  deleteFilePath: (code: string, fpId: string) =>
    call<{ ok: boolean }>(
      'DELETE',
      `${taskBase()}/${encodeURIComponent(code)}/file-paths/${encodeURIComponent(fpId)}`,
    ),
  approve: (code: string) =>
    call<any>('POST', `${taskBase()}/${encodeURIComponent(code)}/transition`, {
      to_status: 'done',
      to_assignee: 'human',
      by_role: 'human',
    }),
  reject: (code: string, reject_comment: string) =>
    call<any>('POST', `${taskBase()}/${encodeURIComponent(code)}/transition`, {
      to_status: 'agent_working',
      to_assignee: 'worker',
      by_role: 'human',
      reject_comment,
    }),
  transition: (
    code: string,
    payload: { to_status: string; to_assignee: string; by_role: string; reject_comment?: string },
  ) => call<any>('POST', `${taskBase()}/${encodeURIComponent(code)}/transition`, payload),
  sessions: () =>
    call<{
      dir: string;
      dbs: {
        hash: string;
        size: string;
        sizeBytes: number;
        sessions: {
          id: string;
          projectDir: string | null;
          startedAt: string;
          lastEventAt: string;
          eventCount: number;
          compactCount: number;
          firstPrompt?: string | null;
          intent?: string | null;
          role?: string | null;
          topFiles?: { path: string; count: number }[];
          planFiles?: string[];
          source?: 'agentboard' | 'cli';
          taskCode?: string | null;
          projectCode?: string | null;
          repoPath?: string | null;
          provider?: 'claude' | 'github_copilot' | 'codex' | null;
        }[];
      }[];
      error?: string;
    }>('GET', '/api/sessions'),
  prompt: (kind: 'role' | 'skill', id: string) =>
    call<{ kind: string; id: string; path?: string; content?: string; error?: string }>(
      'GET',
      `/api/prompts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    ),
  sessionEvents: (hash: string, sessionId: string) =>
    call<{
      hash: string;
      sessionId: string;
      provider?: 'claude' | 'github_copilot' | 'codex' | null;
      meta: {
        session_id: string;
        project_dir: string | null;
        started_at: string;
        last_event_at: string;
        event_count: number;
        compact_count: number;
      } | null;
      events: {
        id: number;
        type: string;
        category: string | null;
        priority: number | null;
        data: string | null;
        source_hook: string | null;
        created_at: string;
      }[];
      resume: {
        snapshot: string | null;
        event_count: number | null;
        consumed: number | null;
      } | null;
      enrich?: {
        firstPrompt: string | null;
        intent: string | null;
        role: string | null;
        topFiles: { path: string; count: number }[];
        planFiles: string[];
      } | null;
      error?: string;
    }>('GET', `/api/sessions/${encodeURIComponent(hash)}/events/${encodeURIComponent(sessionId)}`),
  deleteTask: (code: string) =>
    call<{ ok: boolean }>('DELETE', `${taskBase()}/${encodeURIComponent(code)}`),
  runAgent: (code: string, role: 'pm' | 'worker' | 'reviewer') =>
    call<{ run_id: string; role: string }>(
      'POST',
      `${taskBase()}/${encodeURIComponent(code)}/run-agent`,
      { role },
    ),
  addComment: (code: string, body: string) =>
    call<{ comment: any }>('POST', `${taskBase()}/${encodeURIComponent(code)}/comments`, { body }),
  getTaskCost: (code: string) => call<any>('GET', `${taskBase()}/${encodeURIComponent(code)}/cost`),
  getBoardCost: () => call<any>('GET', `${boardBase()}/cost`),
  projectCostsTotal: (code: string) =>
    call<any>('GET', `/api/projects/${encodeURIComponent(code)}/costs/total`),
  updateProject: (code: string, patch: Record<string, unknown> & { version: number }) =>
    call<{ ok: boolean; project: any }>(
      'PATCH',
      `/api/projects/${encodeURIComponent(code)}`,
      patch,
    ),
  deleteProject: (code: string) =>
    call<{ ok: boolean; trashed_path: string }>(
      'DELETE',
      `/api/projects/${encodeURIComponent(code)}`,
    ),

  // --- noskills inner phase machine + live activity ---
  activeStates: () =>
    call<{ states: Record<string, RunActiveState> }>('GET', '/api/projects/active-states'),
  runActivity: (runId: string) =>
    call<{ activity: ActivityEvent[] }>('GET', `/api/runs/${encodeURIComponent(runId)}/activity`),
  taskActivity: (taskId: string, limit = 20) =>
    call<{ activity: ActivityEvent[] }>(
      'GET',
      `/api/tasks/${encodeURIComponent(taskId)}/activity?limit=${limit}`,
    ),

  // --- skills (server-backed scan, v0.2) ---
  listSkills: (opts?: { search?: string; dir?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.search) qs.set('search', opts.search);
    if (opts?.dir) qs.set('dir', opts.dir);
    const s = qs.toString();
    return call<{ skills: ApiSkill[] }>('GET', s ? `/api/skills?${s}` : '/api/skills');
  },
  getSkill: (id: string) =>
    call<{ skill: ApiSkillDetail }>('GET', `/api/skills/${encodeURIComponent(id)}`),
  updateSkill: (
    id: string,
    patch: Partial<Pick<ApiSkillDetail, 'name' | 'description' | 'emblem' | 'tags' | 'allowedTools' | 'body'>>,
  ) => call<{ skill: ApiSkill }>('PUT', `/api/skills/${encodeURIComponent(id)}`, patch),
  scanSkills: (trigger: ScanTrigger = 'manual') =>
    call<{ scanId: string; status: 'queued' }>('POST', '/api/skills/scan', { trigger }),
  latestSkillScan: () => call<ApiScan | null>('GET', '/api/skills/scan/latest'),
  skillDirs: () => call<{ dirs: string[] }>('GET', '/api/skills/dirs'),
};

export interface ApiSkill {
  id: string;
  name: string;
  description: string;
  emblem: string;
  tags: string[];
  relDir: string;
  relPath: string;
  layout: 'folder' | 'file';
  allowedTools: string[];
  scannedAt: string;
}
export interface ApiSkillDetail extends ApiSkill {
  body: string;
  absPath: string;
}
export type ScanTrigger = 'project_created' | 'project_switched' | 'repo_path_changed' | 'manual';
export interface ApiScan {
  id: string;
  projectCode: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  startedAt: string | null;
  endedAt: string | null;
  foundCount: number;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  error: string | null;
  trigger: ScanTrigger;
  createdAt: string;
}

export interface SkillScanEvent {
  type: 'skill-scan:started' | 'skill-scan:finished' | 'skill-scan:latest';
  scan: ApiScan | null;
}

export type Phase = 'DISCOVERY' | 'REFINEMENT' | 'PLANNING' | 'EXECUTING' | 'VERIFICATION' | 'DONE';

export type ActivityKind =
  | 'phase:advanced'
  | 'phase:exit'
  | 'tool:invoked'
  | 'tool:blocked'
  | 'debt:recorded'
  | 'debt:resolved'
  | 'run:started'
  | 'run:finished'
  | 'comment:posted'
  | 'ac:evidenced'
  | 'skill:used'
  | 'skill:missed';

export interface ActivityEvent {
  id: string;
  run_id: string;
  task_id: string;
  kind: ActivityKind | string;
  payload: Record<string, unknown>;
  at: string;
}

export interface RunActiveState {
  task_code: string;
  run_id: string | null;
  run_status: string | null;
  phase: Phase | null;
  last_kind: string | null;
  last_at: string | null;
  debt_count: number;
}
