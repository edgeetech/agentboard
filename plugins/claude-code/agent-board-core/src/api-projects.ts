import { mkdirSync, copyFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, resolve as pathResolve, sep } from 'node:path';

import { z } from 'zod';

import { readConfig, writeConfig } from './config.ts';
import type { DbHandle } from './db.ts';
import { json, readJson } from './http-util.ts';
import { dataDir, projectDbPath, trashDir } from './paths.ts';
import { validateCode, suggestCode } from './project-code.ts';
import { openOrCreate, listProjectDbs, getDb, getActiveDb, closeDb } from './project-registry.ts';
import { createProject, getProject, updateProject } from './repo.ts';
import { latestScan, recordScan, type ScanTrigger } from './skill-repo.ts';
import { ensureSkillScanWorker } from './skill-scan-runtime.ts';

// ── Skill-scan trigger helpers ────────────────────────────────────────────────

const SKIP_RESCAN_WINDOW_MS = 30 * 60 * 1000;

/** True when a successful scan finished within SKIP_RESCAN_WINDOW_MS. */
export function shouldSkipSwitchScan(
  db: DbHandle,
  projectCode: string,
  nowMs: number = Date.now(),
): boolean {
  const last = latestScan(db, projectCode);
  if (last?.status !== 'succeeded' || last.endedAt === null) return false;
  const ended = Date.parse(last.endedAt);
  if (!Number.isFinite(ended)) return false;
  return nowMs - ended < SKIP_RESCAN_WINDOW_MS;
}

function enqueueScan(db: DbHandle, projectCode: string, trigger: ScanTrigger): void {
  try {
    recordScan(db, { projectCode, trigger });
  } catch (e) {
    console.warn(
      '[api-projects] recordScan failed:',
      projectCode,
      trigger,
      (e as Error | null)?.message ?? String(e),
    );
  }
}

// scan_ignore_json input: array of strings OR newline-separated string.
// String form is split on \n; lines starting with `#` (after trim) and blanks
// are dropped. Server-side validation enforces shape only — path semantics
// (glob syntax, accidental absolute paths) are scanner concerns.
const ScanIgnoreInput = z.union([
  z.array(z.string().max(500)).max(200),
  z.string().max(50_000),
]);

export function normalizeScanIgnore(raw: unknown): string[] | { error: string } {
  const parsed = ScanIgnoreInput.safeParse(raw);
  if (!parsed.success) return { error: 'scan_ignore_json must be string[] or string' };
  if (typeof parsed.data === 'string') {
    const lines = parsed.data
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    if (lines.length > 200) return { error: 'scan_ignore_json too many entries (max 200)' };
    if (lines.some((l) => l.length > 500))
      return { error: 'scan_ignore_json entries too long (max 500)' };
    return lines;
  }
  return parsed.data;
}

function arrEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function parseStoredIgnore(s: string | null | undefined): string[] {
  if (s === null || s === undefined || s === '') return [];
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface RepoPathOk {
  ok: true;
  canonical: string;
}
interface RepoPathErr {
  ok: false;
  error: string;
}
type RepoPathResult = RepoPathOk | RepoPathErr;

function validateRepoPath(raw: unknown): RepoPathResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'repo_path required' };
  if (!isAbsolute(raw)) return { ok: false, error: 'repo_path must be absolute' };
  const canonical = pathResolve(raw);
  const dd = pathResolve(dataDir());
  if (canonical === dd || canonical.startsWith(dd + sep)) {
    return { ok: false, error: 'repo_path cannot be inside the agentboard data dir' };
  }
  try {
    const st = statSync(canonical);
    if (!st.isDirectory()) return { ok: false, error: 'repo_path not a directory' };
  } catch {
    return { ok: false, error: 'repo_path does not exist' };
  }
  return { ok: true, canonical: canonical.replace(/\\/g, '/') };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function handleProjects(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean | null | undefined> {
  const p = url.pathname;
  const m = req.method ?? '';

  if (p === '/api/projects/active' && m === 'GET') {
    const active = await getActiveDb();
    if (!active) {
      json(res, 200, { project: null });
      return;
    }
    json(res, 200, { project: getProject(active.db) });
    return true;
  }

  if (p === '/api/projects/list' && m === 'GET') {
    const codes = listProjectDbs();
    const projects: unknown[] = [];
    for (const c of codes) {
      try {
        projects.push(getProject(await getDb(c)));
      } catch {
        /* skip */
      }
    }
    json(res, 200, { projects });
    return true;
  }

  if (p === '/api/projects/suggest-code' && m === 'GET') {
    const name = url.searchParams.get('name') ?? '';
    const existing = new Set(listProjectDbs());
    json(res, 200, { code: suggestCode(name, existing) });
    return true;
  }

  if (p === '/api/projects' && m === 'POST') {
    const body = await readJson(req);
    if (!isRecord(body)) {
      json(res, 400, { error: 'invalid body' });
      return;
    }
    const { code, name, description, workflow_type, repo_path, agent_provider } = body;

    const codeErr = validateCode(typeof code === 'string' ? code : '');
    if (codeErr) {
      json(res, 400, { error: codeErr });
      return;
    }
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      typeof workflow_type !== 'string' ||
      workflow_type.length === 0 ||
      repo_path === null ||
      repo_path === undefined
    ) {
      json(res, 400, { error: 'name, workflow_type, repo_path required' });
      return;
    }
    if (!['WF1', 'WF2'].includes(workflow_type)) {
      json(res, 400, { error: 'workflow_type must be WF1 or WF2' });
      return;
    }
    if (
      typeof agent_provider === 'string' &&
      !['claude', 'github_copilot', 'codex'].includes(agent_provider)
    ) {
      json(res, 400, { error: 'agent_provider must be "claude", "github_copilot", or "codex"' });
      return;
    }
    const rp = validateRepoPath(repo_path);
    if (!rp.ok) {
      json(res, 400, { error: rp.error });
      return;
    }
    const codeStr = String(code);
    if (listProjectDbs().includes(codeStr.toLowerCase())) {
      json(res, 409, { error: 'code already in use' });
      return;
    }
    const db = await openOrCreate(codeStr);
    const project = createProject(db, {
      code: codeStr,
      name,
      ...(typeof description === 'string' ? { description } : {}),
      workflow_type: workflow_type as 'WF1' | 'WF2',
      repo_path: rp.canonical,
      ...(typeof agent_provider === 'string'
        ? { agent_provider: agent_provider as 'claude' | 'github_copilot' | 'codex' }
        : {}),
    });
    const cfg = readConfig();
    if (
      cfg.active_project_code === null ||
      cfg.active_project_code === undefined ||
      cfg.active_project_code === ''
    )
      writeConfig({ active_project_code: codeStr });
    // Initial skill scan: enqueue and ensure a worker exists for this brand-new
    // project DB (server boot only spun up workers for DBs that existed at boot).
    enqueueScan(db, codeStr, 'project_created');
    void ensureSkillScanWorker(codeStr);
    json(res, 201, { project });
    return true;
  }

  if (p === '/api/projects/active' && m === 'PATCH') {
    const body = await readJson(req);
    if (!isRecord(body)) {
      json(res, 400, { error: 'invalid body' });
      return;
    }
    const { code } = body;
    if (typeof code !== 'string' || !code) {
      json(res, 400, { error: 'code required' });
      return;
    }
    const db = await getDb(code).catch(() => null);
    if (!db) {
      json(res, 404, { error: 'no such project' });
      return;
    }
    const prevActive = readConfig().active_project_code;
    writeConfig({ active_project_code: code });
    // Re-scan on switch unless we already have a fresh successful scan.
    if (typeof prevActive !== 'string' || prevActive !== code) {
      if (!shouldSkipSwitchScan(db, code)) {
        enqueueScan(db, code, 'project_switched');
      }
    }
    json(res, 200, { ok: true });
    return true;
  }

  const codeMatch = /^\/api\/projects\/([A-Z0-9]{2,7})$/.exec(p);

  if (codeMatch && m === 'PATCH') {
    const code = String(codeMatch[1]);
    const db = await getDb(code).catch(() => null);
    if (!db) {
      json(res, 404, { error: 'no such project' });
      return;
    }
    const body = await readJson(req);
    if (!isRecord(body)) {
      json(res, 400, { error: 'invalid body' });
      return;
    }
    const { version, ...patch } = body;

    for (const k of ['code', 'workflow_type', 'id', 'created_at']) {
      if (k in patch) {
        json(res, 400, { error: `${k} is immutable` });
        return;
      }
    }
    if ('repo_path' in patch) {
      const rp = validateRepoPath(patch.repo_path);
      if (!rp.ok) {
        json(res, 400, { error: rp.error });
        return;
      }
      patch.repo_path = rp.canonical;
    }
    if ('scan_ignore_json' in patch) {
      const norm = normalizeScanIgnore(patch.scan_ignore_json);
      if (!Array.isArray(norm)) {
        json(res, 400, { error: norm.error });
        return;
      }
      patch.scan_ignore_json = norm;
    }
    if ('max_parallel' in patch) {
      const n = parseInt(String(patch.max_parallel), 10);
      if (!Number.isFinite(n) || n < 1 || n > 3) {
        json(res, 400, { error: 'max_parallel must be 1..3' });
        return;
      }
      patch.max_parallel = n;
    }
    if ('agent_provider' in patch) {
      const ap = str(patch.agent_provider);
      if (ap === undefined || !['claude', 'github_copilot', 'codex'].includes(ap)) {
        json(res, 400, { error: 'agent_provider must be "claude", "github_copilot", or "codex"' });
        return;
      }
    }
    if ('auto_dispatch_pm' in patch) {
      delete patch.auto_dispatch_pm;
    }

    // Capture pre-update values so we can detect actual changes for trigger
    // decisions (avoid spurious scans when caller PATCHes with the same value).
    const before = getProject(db);
    const beforeRepoPath = before?.repo_path ?? '';
    const beforeIgnore = parseStoredIgnore(before?.scan_ignore_json);

    const out = updateProject(db, patch, typeof version === 'number' ? version : 0);
    if (!out.ok) {
      json(res, 409, { error: out.reason });
      return;
    }

    // Trigger a scan when the inputs the scanner depends on actually changed.
    // We re-use 'repo_path_changed' for scan_ignore_json updates too — both
    // mean "the repo's scan inputs changed", and reusing avoids a schema
    // migration of the trigger CHECK constraint. (See plan L5 note.)
    let needScan = false;
    if (
      'repo_path' in patch &&
      typeof patch.repo_path === 'string' &&
      patch.repo_path !== beforeRepoPath
    ) {
      needScan = true;
    }
    if ('scan_ignore_json' in patch && Array.isArray(patch.scan_ignore_json)) {
      const ignoreArr = (patch.scan_ignore_json as unknown[]).filter((v): v is string => typeof v === 'string');
      if (!arrEq(ignoreArr, beforeIgnore)) needScan = true;
    }
    if (needScan) enqueueScan(db, code, 'repo_path_changed');

    json(res, 200, out);
    return true;
  }

  if (codeMatch && m === 'DELETE') {
    const code = String(codeMatch[1]);
    const lower = code.toLowerCase();
    const db = await getDb(code).catch(() => null);
    if (!db) {
      json(res, 404, { error: 'no such project' });
      return;
    }

    try {
      db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
    } catch {
      /* ignore */
    }

    closeDb(code);
    const src = projectDbPath(lower);
    const trash = trashDir();
    try {
      mkdirSync(trash, { recursive: true });
    } catch {
      /* ignore */
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dst = `${trash}/${lower}-${ts}.db`;

    let trashed: string | null = null;
    try {
      renameSync(src, dst);
      trashed = dst;
    } catch {
      try {
        copyFileSync(src, dst);
        unlinkSync(src);
        trashed = dst;
      } catch (e) {
        json(res, 500, { error: `could not trash db: ${(e as Error).message}` });
        return;
      }
    }

    const cfg = readConfig();
    const apc = cfg.active_project_code;
    if (typeof apc === 'string' && apc.toUpperCase() === code) {
      writeConfig({ active_project_code: null });
    }

    json(res, 200, { ok: true, trashed_path: trashed });
    return true;
  }

  return null;
}
