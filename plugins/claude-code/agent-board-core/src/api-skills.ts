// Skills HTTP API. CRUD + scan trigger + SSE events for the skills board.

import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';

import { z } from 'zod';

import {
  BUILTIN_SKILLS,
  findBuiltinSkill,
  isBuiltinSkillId,
} from './builtin-skills.ts';
import {
  agentboardBus,
  type SkillScanFinishedPayload,
  type SkillScanStartedPayload,
} from './event-bus.ts';
import { json, readJson } from './http-util.ts';
import { getActiveDb } from './project-registry.ts';
import { getProject } from './repo.ts';
import {
  getSkill,
  latestScan,
  listSkills,
  recordScan,
  type ScanRow,
  type SkillRow,
  upsertSkillIndex as _unusedUpsert,
} from './skill-repo.ts';
import { parseFrontmatter } from './skill-scanner.ts';

void _unusedUpsert; // keep import resolution stable; not called here

// ── Response types ───────────────────────────────────────────────────────────

export interface SkillResponse {
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

export interface SkillDetailResponse extends SkillResponse {
  body: string;
  absPath: string;
}

function toSkillResponse(r: SkillRow): SkillResponse {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    emblem: r.emblem,
    tags: r.tags,
    relDir: r.relDir,
    relPath: r.relPath,
    layout: r.layout,
    allowedTools: r.allowedTools,
    scannedAt: r.scannedAt,
  };
}

// ── zod schemas ──────────────────────────────────────────────────────────────

const PutSkillSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(2000).optional(),
    emblem: z.string().max(8).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    allowedTools: z.array(z.string().max(80)).max(50).optional(),
    body: z.string().max(200000).optional(),
  })
  .strict();

const PostScanSchema = z
  .object({
    trigger: z
      .enum(['project_created', 'project_switched', 'repo_path_changed', 'manual'])
      .default('manual'),
  })
  .strict();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function writeFileAtomic(absPath: string, content: string): Promise<void> {
  const tmp = absPath + '.tmp';
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, absPath);
}

function yamlNeedsQuote(s: string): boolean {
  if (s === '') return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/[:#]/.test(s)) return true;
  const first = s[0];
  if (first === '"' || first === "'" || first === '[' || first === '{' || first === '|' || first === '>' || first === '&' || first === '*' || first === '!' || first === '%' || first === '@' || first === '`') return true;
  return false;
}

function yamlScalar(s: string): string {
  if (yamlNeedsQuote(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function buildFrontmatter(args: {
  name: string;
  description: string;
  emblem: string;
  tags: string[];
  allowedTools: string[];
  body: string;
}): string {
  const lines: string[] = ['---'];
  if (args.name !== '') lines.push(`name: ${yamlScalar(args.name)}`);
  if (args.description !== '') lines.push(`description: ${yamlScalar(args.description)}`);
  if (args.emblem !== '') lines.push(`emblem: ${yamlScalar(args.emblem)}`);
  if (args.tags.length > 0) {
    lines.push('tags:');
    for (const t of args.tags) lines.push(`  - ${yamlScalar(t)}`);
  }
  if (args.allowedTools.length > 0) {
    lines.push('allowed-tools:');
    for (const t of args.allowedTools) lines.push(`  - ${yamlScalar(t)}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n' + args.body;
}

function resolveSafeAbsPath(repoPath: string, relPath: string): { ok: true; abs: string } | { ok: false } {
  const root = path.resolve(repoPath);
  const abs = path.resolve(repoPath, relPath);
  const sep = path.sep;
  if (abs !== root && !abs.startsWith(root + sep)) return { ok: false };
  return { ok: true, abs };
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function handleSkills(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<true | null> {
  const p = url.pathname;
  const m = req.method ?? '';

  if (!p.startsWith('/api/skills')) return null;

  // GET /api/skills
  if (p === '/api/skills' && m === 'GET') {
    const search = url.searchParams.get('search') ?? undefined;
    const dir = url.searchParams.get('dir') ?? undefined;
    const active = await getActiveDb();

    let scanned: SkillResponse[] = [];
    if (active) {
      const opts: { search?: string; dir?: string } = {};
      if (search !== undefined) opts.search = search;
      if (dir !== undefined) opts.dir = dir;
      const rows = listSkills(active.db, active.code, opts);
      scanned = rows.map(toSkillResponse);
    }

    const includeBuiltins = dir === undefined || dir === 'builtin';
    let builtins: SkillResponse[] = [];
    if (includeBuiltins) {
      const list: SkillResponse[] = BUILTIN_SKILLS.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        emblem: s.emblem,
        tags: s.tags,
        relDir: s.relDir,
        relPath: s.relPath,
        layout: s.layout,
        allowedTools: s.allowedTools,
        scannedAt: s.scannedAt,
      }));
      const needle = search?.trim().toLowerCase() ?? '';
      builtins = needle
        ? list.filter(
            (s) =>
              s.name.toLowerCase().includes(needle) ||
              s.description.toLowerCase().includes(needle),
          )
        : list;
    }

    json(res, 200, { skills: [...scanned, ...builtins] });
    return true;
  }

  // GET /api/skills/dirs
  if (p === '/api/skills/dirs' && m === 'GET') {
    const active = await getActiveDb();
    let dirs: string[] = [];
    if (active) {
      const rows = active.db
        .prepare(
          `SELECT DISTINCT rel_dir FROM skill WHERE project_code=? AND deleted_at IS NULL ORDER BY rel_dir ASC`,
        )
        .all(active.code) as { rel_dir: string }[];
      dirs = rows.map((r) => r.rel_dir);
    }
    if (!dirs.includes('builtin')) dirs.push('builtin');
    json(res, 200, { dirs });
    return true;
  }

  // GET /api/skills/scan/latest
  if (p === '/api/skills/scan/latest' && m === 'GET') {
    const active = await getActiveDb();
    if (!active) {
      json(res, 200, { scan: null });
      return true;
    }
    const row = latestScan(active.db, active.code);
    json(res, 200, { scan: row });
    return true;
  }

  // GET /api/skills/scan/events  → SSE
  if (p === '/api/skills/scan/events' && m === 'GET') {
    const active = await getActiveDb();
    if (!active) {
      json(res, 404, { error: 'no active project' });
      return true;
    }
    serveScanSse(req, res, active.code);
    return true;
  }

  // POST /api/skills/scan
  if (p === '/api/skills/scan' && m === 'POST') {
    const active = await getActiveDb();
    if (!active) {
      json(res, 404, { error: 'no active project' });
      return true;
    }
    const body = (await readJson(req)) ?? {};
    const parsed = PostScanSchema.safeParse(body);
    if (!parsed.success) {
      json(res, 400, { error: 'invalid body', issues: parsed.error.issues });
      return true;
    }
    const scanId = recordScan(active.db, {
      projectCode: active.code,
      trigger: parsed.data.trigger,
    });
    json(res, 202, { scanId, status: 'queued' });
    return true;
  }

  // GET /api/skills/:id  | PUT /api/skills/:id
  const idMatch = /^\/api\/skills\/([^/]+)$/.exec(p);
  if (idMatch && (m === 'GET' || m === 'PUT')) {
    const id = decodeURIComponent(String(idMatch[1]));

    // Built-in skills are served from memory; bypass DB and disk.
    if (isBuiltinSkillId(id)) {
      const builtin = findBuiltinSkill(id);
      if (!builtin) {
        json(res, 404, { error: 'skill not found' });
        return true;
      }
      if (m === 'PUT') {
        json(res, 400, { error: 'built-in skills are read-only' });
        return true;
      }
      const detail: SkillDetailResponse = {
        id: builtin.id,
        name: builtin.name,
        description: builtin.description,
        emblem: builtin.emblem,
        tags: builtin.tags,
        relDir: builtin.relDir,
        relPath: builtin.relPath,
        layout: builtin.layout,
        allowedTools: builtin.allowedTools,
        scannedAt: builtin.scannedAt,
        body: builtin.body,
        absPath: '(built-in)',
      };
      json(res, 200, { skill: detail });
      return true;
    }

    const active = await getActiveDb();
    if (!active) {
      json(res, 404, { error: 'no active project' });
      return true;
    }
    const skill = getSkill(active.db, id);
    if (skill?.projectCode !== active.code || skill.deletedAt !== null) {
      json(res, 404, { error: 'skill not found' });
      return true;
    }
    const project = getProject(active.db);
    if (!project) {
      json(res, 404, { error: 'no project' });
      return true;
    }
    const safe = resolveSafeAbsPath(project.repo_path, skill.relPath);
    if (!safe.ok) {
      json(res, 400, { error: 'invalid rel_path' });
      return true;
    }

    if (m === 'GET') {
      let raw = '';
      try {
        raw = await fs.readFile(safe.abs, 'utf8');
      } catch (e) {
        console.warn('[api-skills] read failed', (e as Error).message);
        json(res, 404, { error: 'SKILL.md not readable' });
        return true;
      }
      const parsed = parseFrontmatter(raw);
      const detail: SkillDetailResponse = {
        ...toSkillResponse(skill),
        body: parsed.body,
        absPath: safe.abs,
      };
      json(res, 200, { skill: detail });
      return true;
    }

    // PUT
    const body = await readJson(req);
    const parsedPut = PutSkillSchema.safeParse(body ?? {});
    if (!parsedPut.success) {
      json(res, 400, { error: 'invalid body', issues: parsedPut.error.issues });
      return true;
    }
    const patch = parsedPut.data;

    // Read current to merge unspecified fields.
    let currentRaw = '';
    try {
      currentRaw = await fs.readFile(safe.abs, 'utf8');
    } catch {
      // file may not yet exist (rare); fall through with empty current
    }
    const current = parseFrontmatter(currentRaw);

    const nextName = patch.name ?? skill.name;
    const nextDescription = patch.description ?? skill.description;
    const nextEmblem = patch.emblem ?? skill.emblem;
    const nextTags = patch.tags ?? skill.tags;
    const nextAllowedTools = patch.allowedTools ?? skill.allowedTools;
    const nextBody = patch.body ?? current.body;

    const content = buildFrontmatter({
      name: nextName,
      description: nextDescription,
      emblem: nextEmblem,
      tags: nextTags,
      allowedTools: nextAllowedTools,
      body: nextBody,
    });

    try {
      await writeFileAtomic(safe.abs, content);
    } catch (e) {
      console.error('[api-skills] write failed', (e as Error).message);
      json(res, 500, { error: 'write failed' });
      return true;
    }

    // Re-parse the canonical written form to confirm.
    const reparsed = parseFrontmatter(content);
    const tagsJson = JSON.stringify(reparsed.tags ?? nextTags);
    const allowedJson = JSON.stringify(reparsed.allowedTools ?? nextAllowedTools);
    const now = new Date().toISOString();
    active.db
      .prepare(
        `UPDATE skill SET name=?, description=?, emblem=?, tags_json=?, allowed_tools_json=?, scanned_at=? WHERE id=?`,
      )
      .run(
        reparsed.name ?? nextName,
        reparsed.description ?? nextDescription,
        reparsed.emblem ?? nextEmblem,
        tagsJson,
        allowedJson,
        now,
        id,
      );

    const updated = getSkill(active.db, id);
    if (!updated) {
      json(res, 500, { error: 'updated row missing' });
      return true;
    }
    json(res, 200, { skill: toSkillResponse(updated) });
    return true;
  }

  return null;
}

// ── SSE for skill-scan events ────────────────────────────────────────────────

function sendSse(res: ServerResponse, event: string, data: unknown): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

function serveScanSse(
  req: IncomingMessage,
  res: ServerResponse,
  projectCode: string,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`: agentboard skill-scan SSE ready (project=${projectCode})\n\n`);

  // Emit current latest scan as initial state for reconnects.
  void (async (): Promise<void> => {
    try {
      const active = await getActiveDb();
      if (active?.code !== projectCode) return;
      const row = latestScan(active.db, projectCode);
      if (row !== null) sendSse(res, 'skill-scan:latest', row);
    } catch (e) {
      console.warn('[api-skills sse] initial state failed', (e as Error).message);
    }
  })();

  const onStarted = (evt: SkillScanStartedPayload): void => {
    if (evt.projectCode !== projectCode) return;
    try {
      sendSse(res, 'skill-scan:started', evt);
    } catch {
      /* client gone */
    }
  };
  const onFinished = (evt: SkillScanFinishedPayload): void => {
    if (evt.projectCode !== projectCode) return;
    try {
      sendSse(res, 'skill-scan:finished', evt);
    } catch {
      /* client gone */
    }
  };
  const startedKey = 'skill-scan:started';
  const finishedKey = 'skill-scan:finished';
  // The shared bus is loosely typed; cast event names.
  (agentboardBus as unknown as {
    on: (k: string, h: (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void) => void;
    off: (k: string, h: (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void) => void;
  }).on(startedKey, onStarted as (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void);
  (agentboardBus as unknown as {
    on: (k: string, h: (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void) => void;
    off: (k: string, h: (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void) => void;
  }).on(finishedKey, onFinished as (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void);

  const hb = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(hb);
    }
  }, 25_000);

  const cleanup = (): void => {
    clearInterval(hb);
    (agentboardBus as unknown as {
      off: (k: string, h: (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void) => void;
    }).off(startedKey, onStarted as (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void);
    (agentboardBus as unknown as {
      off: (k: string, h: (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void) => void;
    }).off(finishedKey, onFinished as (e: SkillScanStartedPayload | SkillScanFinishedPayload) => void);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);

  // Reference to silence unused warning.
  void (null as unknown as ScanRow);
}
