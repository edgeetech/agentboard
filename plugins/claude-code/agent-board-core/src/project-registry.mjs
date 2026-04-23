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
