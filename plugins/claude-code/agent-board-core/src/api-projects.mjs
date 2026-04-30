import { json, readJson } from './http-util.mjs';
import { validateCode, suggestCode } from './project-code.mjs';
import { createProject, getProject, updateProject } from './repo.mjs';
import { openOrCreate, listProjectDbs, getDb, getActiveDb, closeDb } from './project-registry.mjs';
import { writeConfig, readConfig } from './config.mjs';
import { dataDir, projectDbPath, trashDir } from './paths.mjs';
import { statSync, renameSync, mkdirSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { isAbsolute, resolve as pathResolve, sep } from 'node:path';

/**
 * Normalize + validate a user-supplied repo_path. Returns { ok, canonical, error }.
 * Used by both POST (create) and PATCH (edit in settings).
 */
function validateRepoPath(raw) {
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

export async function handleProjects(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/projects/active' && m === 'GET') {
    const active = await getActiveDb();
    if (!active) return json(res, 200, { project: null });
    return json(res, 200, { project: getProject(active.db) });
  }

  if (p === '/api/projects/list' && m === 'GET') {
    const codes = listProjectDbs();
    const projects = [];
    for (const c of codes) {
      try { projects.push(getProject(await getDb(c))); } catch {}
    }
    return json(res, 200, { projects });
  }

  if (p === '/api/projects/suggest-code' && m === 'GET') {
    const name = url.searchParams.get('name') || '';
    const existing = new Set(listProjectDbs());
    return json(res, 200, { code: suggestCode(name, existing) });
  }

  if (p === '/api/projects' && m === 'POST') {
    const body = await readJson(req);
    const { code, name, description, workflow_type, repo_path, agent_provider } = body || {};
    const codeErr = validateCode(code);
    if (codeErr) return json(res, 400, { error: codeErr });
    if (!name || !workflow_type || !repo_path) {
      return json(res, 400, { error: 'name, workflow_type, repo_path required' });
    }
    if (!['WF1', 'WF2'].includes(workflow_type)) {
      return json(res, 400, { error: 'workflow_type must be WF1 or WF2' });
    }
    // Validate agent_provider if provided
    if (agent_provider && !['claude', 'github_copilot'].includes(agent_provider)) {
      return json(res, 400, { error: 'agent_provider must be "claude" or "github_copilot"' });
    }
    const rp = validateRepoPath(repo_path);
    if (!rp.ok) return json(res, 400, { error: rp.error });
    if (listProjectDbs().includes(code.toLowerCase())) {
      return json(res, 409, { error: 'code already in use' });
    }
    const db = await openOrCreate(code);
    const project = createProject(db, {
      code, name, description, workflow_type,
      repo_path: rp.canonical,
      ...(agent_provider && { agent_provider }),
    });
    // First project auto-activated
    const cfg = readConfig();
    if (!cfg.active_project_code) writeConfig({ active_project_code: code });
    return json(res, 201, { project });
  }

  if (p === '/api/projects/active/select' && m === 'POST') {
    const body = await readJson(req);
    const { code } = body || {};
    if (!listProjectDbs().includes(code.toLowerCase())) {
      return json(res, 404, { error: 'no such project' });
    }
    writeConfig({ active_project_code: code });
    return json(res, 200, { ok: true });
  }

  const codeMatch = /^\/api\/projects\/([A-Z0-9]{2,7})$/.exec(p);

  if (codeMatch && m === 'PATCH') {
    const code = codeMatch[1];
    const db = await getDb(code).catch(() => null);
    if (!db) return json(res, 404, { error: 'no such project' });
    const body = await readJson(req);
    const { version, ...patch } = body || {};

    // Block immutable fields explicitly (belt + SQL trigger)
    for (const k of ['code', 'workflow_type', 'id', 'created_at']) {
      if (k in patch) return json(res, 400, { error: `${k} is immutable` });
    }
    // Validate repo_path if changing
    if ('repo_path' in patch) {
      const rp = validateRepoPath(patch.repo_path);
      if (!rp.ok) return json(res, 400, { error: rp.error });
      patch.repo_path = rp.canonical;
    }
    // Clamp max_parallel
    if ('max_parallel' in patch) {
      const n = parseInt(patch.max_parallel, 10);
      if (!Number.isFinite(n) || n < 1 || n > 3) {
        return json(res, 400, { error: 'max_parallel must be 1..3' });
      }
      patch.max_parallel = n;
    }
    // Validate agent_provider if changing
    if ('agent_provider' in patch) {
      if (!['claude', 'github_copilot'].includes(patch.agent_provider)) {
        return json(res, 400, { error: 'agent_provider must be "claude" or "github_copilot"' });
      }
    }
    if ('auto_dispatch_pm' in patch) {
      delete patch.auto_dispatch_pm; // field removed; ignore silently
    }

    const out = updateProject(db, patch, version);
    if (!out.ok) return json(res, 409, { error: out.reason });
    return json(res, 200, out);
  }

  if (codeMatch && m === 'DELETE') {
    const code = codeMatch[1];
    const lower = code.toLowerCase();
    const db = await getDb(code).catch(() => null);
    if (!db) return json(res, 404, { error: 'no such project' });

    // Checkpoint WAL so all data is in the main DB file before we close.
    try { db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run(); } catch {}

    // Close handle before moving files
    closeDb(code);
    const src = projectDbPath(lower);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dst = `${trashDir()}${sep}${lower}-${ts}.db`;
    try { mkdirSync(trashDir(), { recursive: true }); } catch {}

    // Remove WAL/SHM sidecars — on Windows these block rename of the main file.
    for (const ext of ['-wal', '-shm']) {
      try { if (existsSync(src + ext)) unlinkSync(src + ext); } catch {}
    }

    // Move main DB to trash. On Windows rename can still fail (antivirus, etc.)
    // so fall back to copy+delete which always works.
    let trashed = null;
    try {
      renameSync(src, dst);
      trashed = dst;
    } catch {
      try {
        copyFileSync(src, dst);
        unlinkSync(src);
        trashed = dst;
      } catch (e) {
        return json(res, 500, { error: `could not trash db: ${e?.message || e}` });
      }
    }

    // Clear active project if this was it
    const cfg = readConfig();
    if (cfg.active_project_code && cfg.active_project_code.toUpperCase() === code) {
      writeConfig({ active_project_code: null });
    }

    return json(res, 200, {
      ok: true,
      trashed_path: trashed,
    });
  }

  return null; // not handled
}
