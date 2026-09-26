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

const DEFAULT_TIMEOUT_MS = 30_000;

/** Typed error thrown by call()/raw() — carries HTTP status + parsed body
 *  (when the response was JSON) so call sites can branch on status instead
 *  of string-matching `error.message`. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Combine a caller-supplied AbortSignal (e.g. react-query's queryFn signal)
 *  with a timeout, so slow/hung requests don't poll forever. Falls back to a
 *  plain timeout-only controller when AbortSignal.any isn't available. */
function withTimeout(signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): AbortSignal {
  const timeoutSignal =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : null;
  if (signal && timeoutSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  if (signal) return signal;
  if (timeoutSignal) return timeoutSignal;
  const controller = new AbortController();
  setTimeout(() => { controller.abort(); }, timeoutMs);
  return controller.signal;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  opts?: { signal?: AbortSignal },
): Promise<{ res: Response; text: string; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: withTimeout(opts?.signal),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('Request timed out or was cancelled', 0, null);
    }
    throw new ApiError(err instanceof Error ? err.message : 'Network error', 0, null);
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  return { res, text, json };
}

export async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const { res, text, json } = await request(method, path, body, opts);
  if (!res.ok) {
    const message = (json as { error?: string } | null)?.error || text || `HTTP ${res.status}`;
    throw new ApiError(message, res.status, json);
  }
  return json as T;
}

async function raw(
  method: string,
  path: string,
  opts?: { signal?: AbortSignal },
): Promise<Blob> {
  const { res, text, json } = await request(method, path, undefined, opts);
  if (!res.ok) {
    const message = (json as { error?: string } | null)?.error || text || `HTTP ${res.status}`;
    throw new ApiError(message, res.status, json);
  }
  return new Blob([text]);
}
function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const api = {
  alive: (opts?: { signal?: AbortSignal }) =>
    call<{ ok: boolean; server_id: string; plugin_version: string }>('GET', '/alive', undefined, opts),
  healthz: () => call<any>('GET', '/healthz'),
  doctor: () => call<DoctorResult>('GET', '/api/doctor'),
  projectDoctor: (code: string) =>
    call<DoctorResult>('GET', `/api/projects/${encodeURIComponent(code)}/doctor`),
  listProjects: (opts?: { signal?: AbortSignal }) =>
    call<{ projects: Project[] }>('GET', '/api/projects/list', undefined, opts),
  activeProject: (opts?: { signal?: AbortSignal }) =>
    call<{ project: Project | null }>('GET', '/api/projects/active', undefined, opts),
  selectActiveProject: (code: string) =>
    call<{ ok: boolean }>('PATCH', '/api/projects/active', { code }),
  suggestCode: (name: string) =>
    call<{ code: string }>('GET', `/api/projects/suggest-code?name=${encodeURIComponent(name)}`),
  createProject: (body: {
    code: string;
    name: string;
    description?: string;
    workflow_type: 'WF1' | 'WF2';
    repo_path: string;
  }) => call<{ project: Project }>('POST', '/api/projects', body),
  listTasks: (search?: string, opts?: { signal?: AbortSignal }) =>
    call<{ tasks: Task[] }>(
      'GET',
      search ? `${taskBase()}?search=${encodeURIComponent(search)}` : taskBase(),
      undefined,
      opts,
    ),
  createTask: (body: { title: string; description?: string; assignee_role?: string | null }) =>
    call<{ task: Task }>('POST', taskBase(), body),
  getTask: (code: string, opts?: { signal?: AbortSignal }) =>
    call<{ task: Task; project: Project; comments: Comment[]; file_paths: any[]; agent_runs: AgentRun[] }>(
      'GET',
      `${taskBase()}/${encodeURIComponent(code)}`,
      undefined,
      opts,
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
  prompt: (kind: 'role' | 'skill', id: string) =>
    call<{ kind: string; id: string; path?: string; content?: string; error?: string }>(
      'GET',
      `/api/prompts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    ),
  deleteTask: (code: string) =>
    call<{ ok: boolean }>('DELETE', `${taskBase()}/${encodeURIComponent(code)}`),
  runAgent: (
    code: string,
    role: 'pm' | 'worker' | 'reviewer',
    opts?: { provider?: AgentProvider; use_council?: boolean },
  ) =>
    call<{ run_id: string; role: string }>(
      'POST',
      `${taskBase()}/${encodeURIComponent(code)}/run-agent`,
      { role, ...(opts ?? {}) },
    ),
  cancelRun: (code: string) =>
    call<{ ok: boolean; run_id: string }>(
      'POST',
      `${taskBase()}/${encodeURIComponent(code)}/cancel-run`,
    ),
  addComment: (code: string, body: string) =>
    call<{ comment: any }>('POST', `${taskBase()}/${encodeURIComponent(code)}/comments`, { body }),
  getTaskCost: (code: string) => call<any>('GET', `${taskBase()}/${encodeURIComponent(code)}/cost`),
  getBoardCost: () => call<any>('GET', `${boardBase()}/cost`),
  projectCostsTotal: (code: string) =>
    call<any>('GET', `/api/projects/${encodeURIComponent(code)}/costs/total`),
  projectHealthSummary: (code: string) =>
    call<HealthSummary>('GET', `/api/projects/${encodeURIComponent(code)}/health-summary`),
  projectTracker: (code: string) =>
    call<{ tracker: TrackerConfig | null; status: TrackerStatus }>(
      'GET',
      `/api/projects/${encodeURIComponent(code)}/tracker`,
    ),
  saveProjectTracker: (code: string, body: Partial<TrackerConfigInput>) =>
    call<{ tracker: TrackerConfig; status: TrackerStatus }>(
      'POST',
      `/api/projects/${encodeURIComponent(code)}/tracker`,
      body,
    ),
  enableProjectTracker: (code: string) =>
    call<{ ok: boolean; tracker: TrackerConfig; status: TrackerStatus }>(
      'POST',
      `/api/projects/${encodeURIComponent(code)}/tracker/enable`,
    ),
  disableProjectTracker: (code: string) =>
    call<{ ok: boolean; tracker: TrackerConfig; status: TrackerStatus }>(
      'POST',
      `/api/projects/${encodeURIComponent(code)}/tracker/disable`,
    ),
  syncProjectTracker: (code: string) =>
    call<any>('POST', `/api/projects/${encodeURIComponent(code)}/tracker/sync`),
  downloadTaskAudit: (code: string, format: 'json' | 'md') => {
    const project = getProjectCode();
    const prefix = project ? `/api/projects/${encodeURIComponent(project)}/tasks` : taskBase();
    return raw(
      'GET',
      `${prefix}/${encodeURIComponent(code)}/audit?format=${encodeURIComponent(format)}`,
    );
  },
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
    patch: Partial<
      Pick<ApiSkillDetail, 'name' | 'description' | 'emblem' | 'tags' | 'allowedTools' | 'body'>
    >,
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

export interface TrackerConfigInput {
  kind: 'linear' | 'github' | 'gitlab';
  endpoint?: string | null;
  api_key_env_var: string;
  project_slug: string;
  active_states?: string[];
  terminal_states?: string[];
  assignee?: string | null;
  poll_interval_ms?: number;
  enabled?: boolean;
}

export interface TrackerConfig extends TrackerConfigInput {
  id: string;
  project_id: string;
  active_states: string[];
  terminal_states: string[];
  poll_interval_ms: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrackerStatus {
  env_present: boolean;
  enabled: boolean;
  last_poll_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_issue_count: number;
  next_poll_at: string | null;
  issues_count: number;
  rate_limited: boolean;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  workflow_type: 'WF1' | 'WF2';
  repo_path: string;
  auto_dispatch_pm: number;
  max_parallel: number;
  agent_provider: AgentProvider;
  agent_config_json?: unknown;
  /** JSON string of AuthConfig, or null for all-'auto'. */
  auth_config_json?: string | null;
  scan_ignore_json?: unknown;
  version: number;
}

export interface Task {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  status: string;
  assignee_role: string | null;
  rework_count: number;
  acceptance_criteria_json?: string;
  updated_at?: string;
  has_active_run?: number | boolean;
  agent_provider_override?: AgentProvider | null;
}

export interface Comment {
  id: string;
  author_role: string;
  body: string;
  created_at?: string;
}

export interface AgentRun {
  id: string;
  role: string;
  status: string;
  queued_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  model?: string | null;
  cost_usd?: number | null;
  summary?: string | null;
  error?: string | null;
  session_id?: string | null;
  claude_session_id?: string | null;
  session_provider?: AgentProvider | null;
  /** How the provider authenticated, e.g. 'oauth' (subscription) or 'user' (API key). */
  auth_source?: string | null;
  /** True when cost_usd is an API-equivalent estimate (subscription runs). */
  cost_is_estimate?: boolean;
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'unknown';
  detail: string;
  action?: string;
}

export interface DoctorResult {
  generated_at: string;
  checks: DoctorCheck[];
}

export interface HealthSummary {
  tasks: Record<string, number>;
  runs: Record<string, number>;
  queue: { queued: number; running: number; awaiting_human: number };
  skills: ApiScan | null;
  tracker: TrackerStatus;
  costs: { all_time: number; uncosted_runs: number };
  providers: Record<string, number>;
  generated_at: string;
}

export interface SkillScanEvent {
  type: 'skill-scan:started' | 'skill-scan:finished' | 'skill-scan:latest';
  scan: ApiScan | null;
}

export type AgentProvider = 'claude' | 'github_copilot' | 'codex';

export type RoleConfig =
  | { type: 'single'; provider: AgentProvider }
  | { type: 'council'; members: AgentProvider[] };

export interface AgentConfig {
  pm?: RoleConfig;
  worker?: RoleConfig;
  reviewer?: RoleConfig;
}

export type AuthMode = 'subscription' | 'api_key' | 'auto';
export type AuthConfig = Partial<Record<AgentProvider, AuthMode>>;

export function parseAuthConfig(raw: string | null | undefined): AuthConfig {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === 'object' ? (v as AuthConfig) : {};
  } catch {
    return {};
  }
}

export const COUNCIL_MIN = 2;
export const COUNCIL_MAX = 5;

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
