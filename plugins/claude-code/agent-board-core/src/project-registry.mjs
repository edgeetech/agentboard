// Project registry: scans projects dir for .db files, resolves active project
// from config.json. Each DB file contains exactly one project row.

import { readdirSync } from 'node:fs';
import { projectsDir, projectDbPath } from './paths.mjs';
import { openProjectDb, dbExists } from './db.mjs';
import { readConfig } from './config.mjs';

const openDbs = new Map(); // code → db handle

export async function getDb(code) {
  const lower = code.toLowerCase();
  if (openDbs.has(lower)) return openDbs.get(lower);
  const path = projectDbPath(lower);
  if (!dbExists(path)) throw new Error(`project ${code} db not found`);
  const db = await openProjectDb(path);
  openDbs.set(lower, db);
  return db;
}

export async function openOrCreate(code) {
  const db = await openProjectDb(projectDbPath(code));
  openDbs.set(code.toLowerCase(), db);
  return db;
}

/** Close and evict a cached DB handle. Safe to call even if not cached. */
export function closeDb(code) {
  const lower = code.toLowerCase();
  const db = openDbs.get(lower);
  if (db) {
    try { db.close(); } catch { /* best effort */ }
    openDbs.delete(lower);
  }
}

export function listProjectDbs() {
  try {
    return readdirSync(projectsDir())
      .filter(f => f.endsWith('.db'))
      .map(f => f.replace(/\.db$/, ''));
  } catch { return []; }
}

export async function getActiveDb() {
  const cfg = readConfig();
  if (!cfg.active_project_code) return null;
  try {
    return { code: cfg.active_project_code, db: await getDb(cfg.active_project_code) };
  } catch { return null; }
}

// Find the project DB containing a given agent_run id. Needed because MCP
// callers (spawned agents) reference a run by id, but the run may live in a
// different project than the currently "active" one (the active project is a
// UI focus hint, not a hard scope). Scans all project DBs; cheap because each
// is a small SQLite file with an index on agent_run.id.
export async function getDbForRunId(runId) {
  if (!runId) return null;
  for (const code of listProjectDbs()) {
    try {
      const db = await getDb(code);
      const row = db.prepare('SELECT 1 FROM agent_run WHERE id=?').get(runId);
      if (row) return { code, db };
    } catch { /* skip unreadable db */ }
  }
  return null;
}

// Find the project DB containing a given run_token. Tokens are 24-byte hex,
// effectively unique across the install. Scoped lookup so post-claim MCP
// calls (get_task, update_task, finish_run, …) always resolve to the run's
// own DB regardless of which project the user has focused in the UI.
export async function getDbForRunToken(runToken) {
  if (!runToken) return null;
  for (const code of listProjectDbs()) {
    try {
      const db = await getDb(code);
      const row = db.prepare('SELECT 1 FROM agent_run WHERE token=?').get(runToken);
      if (row) return { code, db };
    } catch { /* skip unreadable db */ }
  }
  return null;
}
