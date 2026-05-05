// Repo helpers for the skill catalog + scan run history. Sits alongside
// repo.ts and phase-repo.ts. Skill IDs are deterministic per project so
// re-scans diff cleanly: `<projectCode>:<sha1(relPath)[:12]>`.

import { createHash } from 'node:crypto';

import type { DbHandle } from './db.ts';
import type { ScannedSkill } from './skill-scanner.ts';
import { isoNow } from './time.ts';
import { ulid } from './ulid.ts';

export type { DbHandle };

// ─── Public row types ───────────────────────────────────────────────────────

export interface SkillRow {
  id: string;
  projectCode: string;
  name: string;
  description: string;
  emblem: string;
  tags: string[];
  relDir: string;
  relPath: string;
  layout: 'folder' | 'file';
  allowedTools: string[];
  scannedAt: string;
  deletedAt: string | null;
}

export type ScanStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ScanTrigger = 'project_created' | 'project_switched' | 'repo_path_changed' | 'manual';

export interface ScanRow {
  id: string;
  projectCode: string;
  status: ScanStatus;
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

// ─── Internal helpers ───────────────────────────────────────────────────────

function safeJsonArray(s: string | null | undefined): string[] {
  if (s === null || s === undefined || s === '') return [];
  try {
    const parsed: unknown = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    return [];
  } catch {
    return [];
  }
}

interface RawSkillRow {
  id: string;
  project_code: string;
  name: string;
  description: string;
  emblem: string;
  tags_json: string;
  rel_dir: string;
  rel_path: string;
  layout: string;
  allowed_tools_json: string;
  scanned_at: string;
  deleted_at: string | null;
}

function toSkillRow(r: unknown): SkillRow {
  const raw = r as RawSkillRow;
  return {
    id: raw.id,
    projectCode: raw.project_code,
    name: raw.name,
    description: raw.description,
    emblem: raw.emblem,
    tags: safeJsonArray(raw.tags_json),
    relDir: raw.rel_dir,
    relPath: raw.rel_path,
    layout: raw.layout === 'file' ? 'file' : 'folder',
    allowedTools: safeJsonArray(raw.allowed_tools_json),
    scannedAt: raw.scanned_at,
    deletedAt: raw.deleted_at,
  };
}

interface RawScanRow {
  id: string;
  project_code: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  found_count: number;
  added_count: number;
  updated_count: number;
  removed_count: number;
  error: string | null;
  trigger: string;
  created_at: string;
}

function toScanStatus(s: string): ScanStatus {
  if (s === 'queued' || s === 'running' || s === 'succeeded' || s === 'failed') return s;
  return 'queued';
}

function toScanTrigger(s: string): ScanTrigger {
  if (s === 'project_created' || s === 'project_switched' || s === 'repo_path_changed' || s === 'manual') return s;
  return 'manual';
}

function toScanRow(r: unknown): ScanRow {
  const raw = r as RawScanRow;
  return {
    id: raw.id,
    projectCode: raw.project_code,
    status: toScanStatus(raw.status),
    startedAt: raw.started_at,
    endedAt: raw.ended_at,
    foundCount: raw.found_count,
    addedCount: raw.added_count,
    updatedCount: raw.updated_count,
    removedCount: raw.removed_count,
    error: raw.error,
    trigger: toScanTrigger(raw.trigger),
    createdAt: raw.created_at,
  };
}

export function computeSkillId(projectCode: string, relPath: string): string {
  const h = createHash('sha1').update(relPath).digest('hex').slice(0, 12);
  return `${projectCode}:${h}`;
}

// ─── Skills ─────────────────────────────────────────────────────────────────

export function listSkills(
  db: DbHandle,
  projectCode: string,
  opts?: { search?: string; dir?: string },
): SkillRow[] {
  const clauses: string[] = ['project_code = ?', 'deleted_at IS NULL'];
  const params: unknown[] = [projectCode];
  const search = opts?.search?.trim() ?? '';
  if (search) {
    const like = '%' + search.toLowerCase() + '%';
    clauses.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags_json) LIKE ?)');
    params.push(like, like, like);
  }
  const dir = opts?.dir?.trim() ?? '';
  if (dir) {
    clauses.push('rel_dir = ?');
    params.push(dir);
  }
  const rows = db
    .prepare(`SELECT * FROM skill WHERE ${clauses.join(' AND ')} ORDER BY name ASC`)
    .all(...params);
  return rows.map(toSkillRow);
}

export function getSkill(db: DbHandle, id: string): SkillRow | null {
  const row = db.prepare(`SELECT * FROM skill WHERE id=?`).get(id);
  if (row === null || row === undefined) return null;
  return toSkillRow(row);
}

export function getSkillByName(
  db: DbHandle,
  projectCode: string,
  name: string,
): SkillRow | null {
  const row = db
    .prepare(
      `SELECT * FROM skill WHERE project_code=? AND LOWER(name)=LOWER(?) AND deleted_at IS NULL LIMIT 1`,
    )
    .get(projectCode, name);
  if (row === null || row === undefined) return null;
  return toSkillRow(row);
}

export function upsertSkillIndex(
  db: DbHandle,
  projectCode: string,
  scanned: ScannedSkill[],
): { added: number; updated: number; removed: number } {
  let added = 0;
  let updated = 0;
  let removed = 0;

  db.exec('BEGIN');
  try {
    const existingRows = db
      .prepare(`SELECT * FROM skill WHERE project_code=? AND deleted_at IS NULL`)
      .all(projectCode)
      .map(toSkillRow);
    const byId = new Map<string, SkillRow>();
    for (const r of existingRows) byId.set(r.id, r);

    const seen = new Set<string>();
    const now = isoNow();

    for (const s of scanned) {
      const id = computeSkillId(projectCode, s.relPath);
      seen.add(id);
      const tagsJson = JSON.stringify(s.tags);
      const allowedJson = JSON.stringify(s.allowedTools);
      const existing = byId.get(id);
      if (!existing) {
        db.prepare(
          `INSERT INTO skill (id, project_code, name, description, emblem, tags_json,
              rel_dir, rel_path, layout, allowed_tools_json, scanned_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        ).run(
          id,
          projectCode,
          s.name,
          s.description,
          s.emblem,
          tagsJson,
          s.relDir,
          s.relPath,
          s.layout,
          allowedJson,
          now,
        );
        added++;
        continue;
      }
      const tagsEq =
        existing.tags.length === s.tags.length &&
        existing.tags.every((t, i) => t === s.tags[i]);
      const allowedEq =
        existing.allowedTools.length === s.allowedTools.length &&
        existing.allowedTools.every((t, i) => t === s.allowedTools[i]);
      const same =
        existing.name === s.name &&
        existing.description === s.description &&
        existing.emblem === s.emblem &&
        existing.relDir === s.relDir &&
        existing.relPath === s.relPath &&
        existing.layout === s.layout &&
        tagsEq &&
        allowedEq;
      if (same) continue;
      db.prepare(
        `UPDATE skill SET name=?, description=?, emblem=?, tags_json=?, rel_dir=?,
              rel_path=?, layout=?, allowed_tools_json=?, scanned_at=?
         WHERE id=?`,
      ).run(
        s.name,
        s.description,
        s.emblem,
        tagsJson,
        s.relDir,
        s.relPath,
        s.layout,
        allowedJson,
        now,
        id,
      );
      updated++;
    }

    for (const [id] of byId) {
      if (seen.has(id)) continue;
      db.prepare(`UPDATE skill SET deleted_at=? WHERE id=?`).run(now, id);
      removed++;
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { added, updated, removed };
}

// ─── Scans ──────────────────────────────────────────────────────────────────

export function recordScan(
  db: DbHandle,
  row: { projectCode: string; trigger: ScanTrigger },
): string {
  const id = ulid();
  const now = isoNow();
  db.prepare(
    `INSERT INTO skill_scan (id, project_code, status, started_at, ended_at,
         found_count, added_count, updated_count, removed_count, error, trigger, created_at)
     VALUES (?, ?, 'queued', NULL, NULL, 0, 0, 0, 0, NULL, ?, ?)`,
  ).run(id, row.projectCode, row.trigger, now);
  return id;
}

type ScanPatchKeys =
  | 'status'
  | 'startedAt'
  | 'endedAt'
  | 'foundCount'
  | 'addedCount'
  | 'updatedCount'
  | 'removedCount'
  | 'error';

const SCAN_PATCH_COLUMNS: Record<ScanPatchKeys, string> = {
  status: 'status',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  foundCount: 'found_count',
  addedCount: 'added_count',
  updatedCount: 'updated_count',
  removedCount: 'removed_count',
  error: 'error',
};

export function updateScan(
  db: DbHandle,
  id: string,
  patch: Partial<Pick<ScanRow, ScanPatchKeys>>,
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of Object.keys(SCAN_PATCH_COLUMNS) as ScanPatchKeys[]) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === undefined) continue;
    sets.push(`${SCAN_PATCH_COLUMNS[k]}=?`);
    params.push(v);
  }
  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE skill_scan SET ${sets.join(', ')} WHERE id=?`).run(...params);
}

export function getScan(db: DbHandle, id: string): ScanRow | null {
  const row = db.prepare(`SELECT * FROM skill_scan WHERE id=?`).get(id);
  if (row === null || row === undefined) return null;
  return toScanRow(row);
}

export function latestScan(db: DbHandle, projectCode: string): ScanRow | null {
  const row = db
    .prepare(
      `SELECT * FROM skill_scan WHERE project_code=? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(projectCode);
  if (row === null || row === undefined) return null;
  return toScanRow(row);
}

export function claimNextQueuedScan(db: DbHandle): ScanRow | null {
  // Atomic CAS: SELECT oldest queued whose project has no running scan,
  // UPDATE-by-id with status guard, all in tx. The NOT EXISTS subquery
  // enforces single-in-flight-per-project: if a scan for the same project
  // is already 'running', queued scans for that project are skipped until
  // it completes (worker re-polls each tick).
  const tx = db.transaction((): ScanRow | null => {
    const candidate = db
      .prepare(
        `SELECT id FROM skill_scan s
         WHERE s.status='queued'
           AND NOT EXISTS (
             SELECT 1 FROM skill_scan r
             WHERE r.project_code = s.project_code AND r.status = 'running'
           )
         ORDER BY created_at ASC, id ASC LIMIT 1`,
      )
      .get() as { id: string } | undefined | null;
    if (candidate === null || candidate === undefined) return null;
    const now = isoNow();
    const info = db
      .prepare(
        `UPDATE skill_scan SET status='running', started_at=? WHERE id=? AND status='queued'`,
      )
      .run(now, candidate.id) as { changes: number };
    if (info.changes === 0) return null;
    const row = db.prepare(`SELECT * FROM skill_scan WHERE id=?`).get(candidate.id);
    if (row === null || row === undefined) return null;
    return toScanRow(row);
  });
  return tx();
}
