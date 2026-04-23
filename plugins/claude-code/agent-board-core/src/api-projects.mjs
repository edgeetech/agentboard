import { json, readJson } from './http-util.mjs';
import { validateCode, suggestCode } from './project-code.mjs';
import { createProject, getProject, updateProject } from './repo.mjs';
import { openOrCreate, listProjectDbs, getDb, getActiveDb } from './project-registry.mjs';
import { writeConfig, readConfig } from './config.mjs';
import { dataDir } from './paths.mjs';
import { statSync } from 'node:fs';
import { isAbsolute, resolve as pathResolve, sep } from 'node:path';

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
    const { code, name, description, workflow_type, repo_path } = body || {};
    const codeErr = validateCode(code);
    if (codeErr) return json(res, 400, { error: codeErr });
    if (!name || !workflow_type || !repo_path) {
      return json(res, 400, { error: 'name, workflow_type, repo_path required' });
    }
    if (!['WF1', 'WF2'].includes(workflow_type)) {
      return json(res, 400, { error: 'workflow_type must be WF1 or WF2' });
    }
    if (!isAbsolute(repo_path)) {
      return json(res, 400, { error: 'repo_path must be absolute' });
    }
    const canonical = pathResolve(repo_path);
    // Block paths under the agentboard data dir — prevents recursive self-reference
    // and agents accidentally clobbering their own state.
    const dd = pathResolve(dataDir());
    if (canonical === dd || canonical.startsWith(dd + sep)) {
      return json(res, 400, { error: 'repo_path cannot be inside the agentboard data dir' });
    }
    try {
      const st = statSync(canonical);
      if (!st.isDirectory()) return json(res, 400, { error: 'repo_path not a directory' });
    } catch {
      return json(res, 400, { error: 'repo_path does not exist' });
    }
    if (listProjectDbs().includes(code.toLowerCase())) {
      return json(res, 409, { error: 'code already in use' });
    }
    const db = await openOrCreate(code);
    const project = createProject(db, {
      code, name, description, workflow_type,
      repo_path: canonical.replace(/\\/g, '/'),
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

  const patchMatch = /^\/api\/projects\/([A-Z0-9]{2,7})$/.exec(p);
  if (patchMatch && m === 'PATCH') {
    const code = patchMatch[1];
    const db = await getDb(code);
    const body = await readJson(req);
    const { version, ...patch } = body || {};
    const out = updateProject(db, patch, version);
    if (!out.ok) return json(res, 409, { error: out.reason });
    return json(res, 200, out);
  }

  return null; // not handled
}
