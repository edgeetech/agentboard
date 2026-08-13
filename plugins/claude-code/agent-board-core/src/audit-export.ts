import type { DbHandle } from './db.ts';
import {
  getProject,
  getTaskByCode,
  listComments,
  listFilePaths,
  listRunsForTask,
  type AgentRunRow,
  type CommentRow,
  type FilePathRow,
  type ProjectRow,
  type TaskRow,
} from './repo.ts';
import type { TrackerIssueRow } from './tracker-sync.ts';

export const AUDIT_EXPORT_MAX_BYTES = 2_000_000;

export interface TaskAuditExport {
  exported_at: string;
  project: ProjectRow;
  task: TaskRow;
  acceptance_criteria: unknown[];
  comments: CommentRow[];
  history: Record<string, unknown>[];
  file_paths: FilePathRow[];
  agent_runs: AgentRunRow[];
  activity: Record<string, unknown>[];
  debt: Record<string, unknown>[];
  tracker_links: TrackerIssueRow[];
  costs: {
    total_usd: number;
    run_count: number;
    uncosted_runs: number;
  };
}

export function buildTaskAudit(db: DbHandle, taskCode: string): TaskAuditExport {
  const project = getProject(db);
  if (project === undefined) throw new Error('project not found');
  const task = getTaskByCode(db, taskCode);
  if (task?.project_id !== project.id) throw new Error('task not found');
  const runs = listRunsForTask(db, task.id);
  const audit: TaskAuditExport = {
    exported_at: new Date().toISOString(),
    project,
    task,
    acceptance_criteria: parseArray(task.acceptance_criteria_json),
    comments: listComments(db, task.id),
    history: allOrEmpty(db, `SELECT * FROM task_history WHERE task_id=? ORDER BY at ASC`, task.id),
    file_paths: listFilePaths(db, task.id),
    agent_runs: runs,
    activity: allOrEmpty(
      db,
      `SELECT * FROM agent_activity WHERE task_id=? ORDER BY at ASC, id ASC`,
      task.id,
    ),
    debt: allOrEmpty(
      db,
      `SELECT * FROM task_debt WHERE task_id=? ORDER BY created_at ASC, id ASC`,
      task.id,
    ),
    tracker_links: allOrEmpty(
      db,
      `SELECT ti.*, t.code AS task_code, t.status AS task_status
       FROM tracker_issue ti
       LEFT JOIN task t ON t.id = ti.task_id
       WHERE ti.project_id=? AND ti.task_id=?
       ORDER BY ti.created_at ASC`,
      project.id,
      task.id,
    ) as unknown as TrackerIssueRow[],
    costs: {
      total_usd: runs.reduce((sum, run) => sum + (run.cost_usd || 0), 0),
      run_count: runs.length,
      uncosted_runs: runs.filter(
        (run) => ['succeeded', 'failed', 'blocked'].includes(run.status) && run.cost_version === 0,
      ).length,
    },
  };
  return redactSecrets(audit);
}

export function renderTaskAuditMarkdown(audit: TaskAuditExport): string {
  const lines: string[] = [];
  lines.push(`# Task Audit: ${esc(audit.task.code)} ${esc(audit.task.title)}`);
  lines.push('');
  lines.push(`Exported: ${esc(audit.exported_at)}`);
  lines.push(`Project: ${esc(audit.project.name)} (${esc(audit.project.code)})`);
  lines.push(
    `Status: ${esc(audit.task.status)} / Assignee: ${esc(audit.task.assignee_role ?? '-')}`,
  );
  lines.push(`Cost: $${audit.costs.total_usd.toFixed(6)} across ${audit.costs.run_count} run(s)`);
  lines.push('');
  section(lines, 'Description', audit.task.description ?? '(empty)');
  section(
    lines,
    'Acceptance Criteria',
    audit.acceptance_criteria.length > 0
      ? audit.acceptance_criteria
          .map((item, i) => `${i + 1}. ${esc(JSON.stringify(item))}`)
          .join('\n')
      : '(none)',
  );
  table(lines, 'History', audit.history, ['from_status', 'to_status', 'by_role', 'at']);
  table(lines, 'Comments', audit.comments, ['author_role', 'body', 'created_at']);
  table(lines, 'Agent Runs', audit.agent_runs, [
    'id',
    'role',
    'status',
    'session_provider',
    'model',
    'cost_usd',
    'queued_at',
    'started_at',
    'ended_at',
  ]);
  table(lines, 'Activity', audit.activity, ['kind', 'payload', 'at']);
  table(lines, 'Debt', audit.debt, ['description', 'carried_count', 'resolved_at', 'created_at']);
  table(lines, 'Attachments', audit.file_paths, ['file_path', 'label', 'created_at']);
  table(lines, 'Tracker Links', audit.tracker_links, [
    'tracker_kind',
    'identifier',
    'title',
    'state',
    'url',
    'synced_at',
  ]);
  return lines.join('\n') + '\n';
}

export function redactSecrets<T>(value: T): T {
  return redact(value) as T;
}

function allOrEmpty(db: DbHandle, sql: string, ...args: unknown[]): Record<string, unknown>[] {
  try {
    return db.prepare(sql).all(...args) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function parseArray(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (isSecretKey(key)) {
        out[key] = child === null ? null : '[REDACTED]';
      } else {
        out[key] = redact(child);
      }
    }
    return out;
  }
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.stringify(redact(JSON.parse(trimmed) as unknown));
    } catch {
      /* fall through to text redaction */
    }
  }
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:gho|ghp|github_pat|sk|xox[abprs])_[A-Za-z0-9_:-]{12,}\b/g, '[REDACTED]')
    .replace(/\b[A-Fa-f0-9]{48,}\b/g, '[REDACTED]');
}

function isSecretKey(key: string): boolean {
  return /(^|[_-])(token|secret|api[_-]?key|authorization|password)([_-]|$)/i.test(key);
}

function section(lines: string[], title: string, body: string): void {
  lines.push(`## ${title}`);
  lines.push('');
  lines.push(esc(body));
  lines.push('');
}

function table(lines: string[], title: string, rows: readonly object[], columns: string[]): void {
  lines.push(`## ${title}`);
  lines.push('');
  if (rows.length === 0) {
    lines.push('(none)');
    lines.push('');
    return;
  }
  lines.push(`| ${columns.map(esc).join(' | ')} |`);
  lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${columns.map((col) => esc(formatCell(getCell(row, col)))).join(' | ')} |`);
  }
  lines.push('');
}

function getCell(row: object, column: string): unknown {
  return (row as Record<string, unknown>)[column];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function esc(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
