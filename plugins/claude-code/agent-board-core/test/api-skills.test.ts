// Unit tests for handleSkills HTTP route handler. Mocks project-registry's
// getActiveDb so the handler operates against an in-memory sqlite DB.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '../src/db.ts';
import { agentboardBus } from '../src/event-bus.ts';
import { listSkills, recordScan, upsertSkillIndex } from '../src/skill-repo.ts';
import type { ScannedSkill } from '../src/skill-scanner.ts';

const PROJECT_CODE = 'TST';

let tmpRoot = '';
let db: DbHandle | undefined;

function dbOrFail(): DbHandle {
  if (db === undefined) throw new Error('db not initialized');
  return db;
}

vi.mock('../src/project-registry.ts', () => {
  return {
    getActiveDb: (): { code: string; db: DbHandle } | null => {
      if (db === undefined) return null;
      return { code: PROJECT_CODE, db };
    },
    getDb: (): DbHandle | undefined => db,
    listProjectDbs: (): string[] => [PROJECT_CODE.toLowerCase()],
  };
});

// Import AFTER mock so handler picks up the mocked module.
const { handleSkills } = await import('../src/api-skills.ts');

async function makeDb(repoPath: string): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE skill (
      id TEXT PRIMARY KEY,
      project_code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      emblem TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      rel_dir TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      layout TEXT NOT NULL CHECK (layout IN ('folder','file')),
      allowed_tools_json TEXT NOT NULL DEFAULT '[]',
      scanned_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE skill_scan (
      id TEXT PRIMARY KEY,
      project_code TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
      started_at TEXT,
      ended_at TEXT,
      found_count INTEGER NOT NULL DEFAULT 0,
      added_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      removed_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      trigger TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      workflow_type TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      max_parallel INTEGER NOT NULL DEFAULT 1,
      agent_provider TEXT NOT NULL DEFAULT 'claude',
      concerns_json TEXT NOT NULL DEFAULT '[]',
      allow_git INTEGER NOT NULL DEFAULT 0,
      scan_ignore_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  d.prepare(
    `INSERT INTO project (id, code, name, workflow_type, repo_path, created_at, updated_at)
     VALUES ('P1', ?, 'Test', 'WF1', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(PROJECT_CODE, repoPath);
  return {
    exec: (s: string) => {
      d.exec(s);
    },
    prepare: (s: string) => {
      const stmt = d.prepare(s);
      return {
        run: (...a: Parameters<typeof stmt.run>) => stmt.run(...a),
        get: (...a: Parameters<typeof stmt.get>) => stmt.get(...a),
        all: (...a: Parameters<typeof stmt.all>) => stmt.all(...a),
      };
    },
    transaction: <T>(fn: (...args: unknown[]) => T): ((...args: unknown[]) => T) => {
      return (...args: unknown[]): T => {
        d.exec('BEGIN');
        try {
          const r = fn(...args);
          d.exec('COMMIT');
          return r;
        } catch (e) {
          d.exec('ROLLBACK');
          throw e;
        }
      };
    },
  } as unknown as DbHandle;
}

function mkSkill(name: string, relPath: string, overrides: Partial<ScannedSkill> = {}): ScannedSkill {
  return {
    name,
    description: `${name} desc`,
    emblem: name.slice(0, 3).toUpperCase(),
    tags: ['t1'],
    allowedTools: ['Read'],
    layout: 'folder',
    relDir: '.claude/skills',
    relPath,
    ...overrides,
  };
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string | number>;
  chunks: Buffer[];
  ended: boolean;
  headersSent: boolean;
  writeHead: (status: number, headers?: Record<string, string | number>) => void;
  write: (chunk: string | Buffer) => boolean;
  end: (chunk?: string | Buffer) => void;
}

function mkRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    chunks: [],
    ended: false,
    headersSent: false,
    writeHead(status, headers) {
      res.statusCode = status;
      if (headers) Object.assign(res.headers, headers);
      res.headersSent = true;
    },
    write(chunk) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      res.chunks.push(buf);
      res.headersSent = true;
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        res.chunks.push(buf);
      }
      res.ended = true;
    },
  };
  return res;
}

function mkReq(method: string, body?: unknown): IncomingMessage {
  const stream = body === undefined
    ? Readable.from([])
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  const req = stream as unknown as IncomingMessage;
  (req as unknown as { method: string }).method = method;
  (req as unknown as { headers: Record<string, string> }).headers = {};
  return req;
}

function readJson(res: MockRes): unknown {
  const text = Buffer.concat(res.chunks).toString('utf8');
  if (!text) return null;
  return JSON.parse(text);
}

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'apiskills-'));
  db = await makeDb(tmpRoot);
});

afterEach(() => {
  if (tmpRoot) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  agentboardBus.removeAllListeners();
});

describe('handleSkills', () => {
  it('returns null for non-skills paths', async () => {
    const res = mkRes();
    const url = new URL('http://x/api/other');
    const out = await handleSkills(mkReq('GET'), res as unknown as ServerResponse, url);
    expect(out).toBeNull();
  });

  it('GET /api/skills returns only built-ins when no scanned skills', async () => {
    const res = mkRes();
    const url = new URL('http://x/api/skills');
    const out = await handleSkills(mkReq('GET'), res as unknown as ServerResponse, url);
    expect(out).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = readJson(res) as { skills: { id: string }[] };
    expect(body.skills.length).toBeGreaterThan(0);
    expect(body.skills.every((s) => s.id.startsWith('builtin:'))).toBe(true);
  });

  it('GET /api/skills lists populated skills with search + dir filters', async () => {
    upsertSkillIndex(dbOrFail(), PROJECT_CODE, [
      mkSkill('alpha', '.claude/skills/alpha/SKILL.md'),
      mkSkill('beta', '.claude/skills/beta/SKILL.md', { relDir: '.claude/skills', description: 'special' }),
      mkSkill('gamma', 'sub/.claude/skills/gamma/SKILL.md', { relDir: 'sub/.claude/skills' }),
    ]);

    {
      const res = mkRes();
      const out = await handleSkills(
        mkReq('GET'),
        res as unknown as ServerResponse,
        new URL('http://x/api/skills'),
      );
      expect(out).toBe(true);
      expect(res.statusCode).toBe(200);
      const body = readJson(res) as { skills: { id: string; name: string }[] };
      const scanned = body.skills.filter((s) => !s.id.startsWith('builtin:'));
      expect(scanned.map((s) => s.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
    }
    {
      const res = mkRes();
      await handleSkills(
        mkReq('GET'),
        res as unknown as ServerResponse,
        new URL('http://x/api/skills?search=special'),
      );
      const body = readJson(res) as { skills: { id: string; name: string }[] };
      const scanned = body.skills.filter((s) => !s.id.startsWith('builtin:'));
      expect(scanned.map((s) => s.name)).toEqual(['beta']);
    }
    {
      const res = mkRes();
      await handleSkills(
        mkReq('GET'),
        res as unknown as ServerResponse,
        new URL('http://x/api/skills?dir=sub/.claude/skills'),
      );
      const body = readJson(res) as { skills: { id: string; name: string }[] };
      // dir filter excludes built-ins, so the result is just the scanned 'gamma'.
      expect(body.skills.map((s) => s.name)).toEqual(['gamma']);
    }
  });

  it('GET /api/skills/dirs returns distinct dirs', async () => {
    upsertSkillIndex(dbOrFail(), PROJECT_CODE, [
      mkSkill('a', '.claude/skills/a/SKILL.md'),
      mkSkill('b', '.claude/skills/b/SKILL.md'),
      mkSkill('c', 'pkg/.claude/skills/c/SKILL.md', { relDir: 'pkg/.claude/skills' }),
    ]);
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills/dirs'),
    );
    expect(res.statusCode).toBe(200);
    const body = readJson(res) as { dirs: string[] };
    expect(body.dirs.sort()).toEqual(['.claude/skills', 'builtin', 'pkg/.claude/skills']);
  });

  it('GET /api/skills/:id returns 404 for unknown id', async () => {
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills/nope'),
    );
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/skills/:id returns 200 with body and absPath', async () => {
    // Create real SKILL.md on disk so handler can read it.
    mkdirSync(join(tmpRoot, '.claude', 'skills', 'demo'), { recursive: true });
    const skillPath = join(tmpRoot, '.claude', 'skills', 'demo', 'SKILL.md');
    const content = `---\nname: demo\ndescription: demo desc\nemblem: DEM\ntags:\n  - x\nallowed-tools:\n  - Read\n---\nHello body`;
    writeFileSync(skillPath, content, 'utf8');

    upsertSkillIndex(dbOrFail(), PROJECT_CODE, [
      mkSkill('demo', '.claude/skills/demo/SKILL.md'),
    ]);
    const list = listSkills(dbOrFail(), PROJECT_CODE);
    const id = list[0]?.id ?? '';

    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL(`http://x/api/skills/${id}`),
    );
    expect(res.statusCode).toBe(200);
    const body = readJson(res) as { skill: { name: string; body: string; absPath: string } };
    expect(body.skill.name).toBe('demo');
    expect(body.skill.body).toContain('Hello body');
    expect(body.skill.absPath).toBe(skillPath);
  });

  it('GET /api/skills/:id returns 400 for path traversal attempts', async () => {
    // Inject a row whose rel_path attempts to escape repo_path.
    const evil = '../../etc/passwd';
    dbOrFail().prepare(
      `INSERT INTO skill (id, project_code, name, description, emblem, tags_json,
         rel_dir, rel_path, layout, allowed_tools_json, scanned_at)
       VALUES ('evil', ?, 'evil', '', '', '[]', '..', ?, 'file', '[]', '2026-01-01T00:00:00Z')`,
    ).run(PROJECT_CODE, evil);

    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills/evil'),
    );
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/skills/:id writes file and updates row', async () => {
    mkdirSync(join(tmpRoot, '.claude', 'skills', 'demo'), { recursive: true });
    const skillPath = join(tmpRoot, '.claude', 'skills', 'demo', 'SKILL.md');
    writeFileSync(
      skillPath,
      `---\nname: demo\ndescription: old\nemblem: DEM\n---\nbody`,
      'utf8',
    );
    upsertSkillIndex(dbOrFail(), PROJECT_CODE, [mkSkill('demo', '.claude/skills/demo/SKILL.md')]);
    const id = listSkills(dbOrFail(), PROJECT_CODE)[0]?.id ?? '';

    const res = mkRes();
    await handleSkills(
      mkReq('PUT', { description: 'new', tags: ['a', 'b'] }),
      res as unknown as ServerResponse,
      new URL(`http://x/api/skills/${id}`),
    );
    expect(res.statusCode).toBe(200);
    const body = readJson(res) as { skill: { description: string; tags: string[] } };
    expect(body.skill.description).toBe('new');
    expect(body.skill.tags).toEqual(['a', 'b']);

    // File on disk should reflect the new content + valid frontmatter.
    const onDisk = readFileSync(skillPath, 'utf8');
    expect(onDisk).toContain('description: new');
    expect(onDisk).toContain('- a');
    expect(onDisk).toContain('- b');
  });

  it('PUT /api/skills/:id rejects unknown body fields', async () => {
    upsertSkillIndex(dbOrFail(), PROJECT_CODE, [mkSkill('demo', '.claude/skills/demo/SKILL.md')]);
    const id = listSkills(dbOrFail(), PROJECT_CODE)[0]?.id ?? '';
    const res = mkRes();
    await handleSkills(
      mkReq('PUT', { foo: 'bar' }),
      res as unknown as ServerResponse,
      new URL(`http://x/api/skills/${id}`),
    );
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/skills/scan returns queued scan', async () => {
    const res = mkRes();
    await handleSkills(
      mkReq('POST', { trigger: 'manual' }),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills/scan'),
    );
    expect(res.statusCode).toBe(202);
    const body = readJson(res) as { scanId: string; status: string };
    expect(body.status).toBe('queued');
    expect(body.scanId).toBeTruthy();
  });

  it('GET /api/skills/scan/latest returns null when no scans', async () => {
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills/scan/latest'),
    );
    expect(res.statusCode).toBe(200);
    expect(readJson(res)).toEqual({ scan: null });
  });

  it('GET /api/skills/scan/latest returns latest after a recordScan', async () => {
    recordScan(dbOrFail(), { projectCode: PROJECT_CODE, trigger: 'manual' });
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills/scan/latest'),
    );
    expect(res.statusCode).toBe(200);
    const body = readJson(res) as { scan: { status: string; trigger: string } };
    expect(body.scan.status).toBe('queued');
    expect(body.scan.trigger).toBe('manual');
  });

  it('GET /api/skills/:id decodes URL-encoded id (regression: %3A in skill ids)', async () => {
    // Inject a skill row whose id contains a colon — matching the
    // <projectCode>:<sha1[:12]> format used in production.
    mkdirSync(join(tmpRoot, '.claude', 'skills', 'enc'), { recursive: true });
    const skillPath = join(tmpRoot, '.claude', 'skills', 'enc', 'SKILL.md');
    writeFileSync(
      skillPath,
      `---\nname: enc\ndescription: enc desc\nemblem: ENC\n---\nbody`,
      'utf8',
    );
    const id = `${PROJECT_CODE}:9a0780d76bce`;
    dbOrFail().prepare(
      `INSERT INTO skill (id, project_code, name, description, emblem, tags_json,
         rel_dir, rel_path, layout, allowed_tools_json, scanned_at)
       VALUES (?, ?, 'enc', 'enc desc', 'ENC', '[]',
         '.claude/skills', '.claude/skills/enc/SKILL.md', 'folder', '[]', '2026-01-01T00:00:00Z')`,
    ).run(id, PROJECT_CODE);

    const encoded = encodeURIComponent(id);
    expect(encoded).toContain('%3A');

    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL(`http://x/api/skills/${encoded}`),
    );
    expect(res.statusCode).toBe(200);
    const body = readJson(res) as { skill: { id: string; name: string } };
    expect(body.skill.id).toBe(id);
    expect(body.skill.name).toBe('enc');
  });

  it('GET /api/skills includes built-in skills even when no scanned skills exist', async () => {
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills'),
    );
    expect(res.statusCode).toBe(200);
    const body = readJson(res) as { skills: { id: string }[] };
    expect(body.skills.length).toBeGreaterThan(0);
    expect(body.skills.every((s) => s.id.startsWith('builtin:'))).toBe(true);
    expect(body.skills.find((s) => s.id === 'builtin:code-review')).toBeTruthy();
  });

  it('GET /api/skills places built-ins after scanned skills', async () => {
    upsertSkillIndex(dbOrFail(), PROJECT_CODE, [
      mkSkill('alpha', '.claude/skills/alpha/SKILL.md'),
    ]);
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills'),
    );
    const body = readJson(res) as { skills: { id: string }[] };
    expect(body.skills[0]?.id.startsWith('builtin:')).toBe(false);
    const firstBuiltinIdx = body.skills.findIndex((s) => s.id.startsWith('builtin:'));
    const lastScannedIdx = body.skills.map((s) => s.id.startsWith('builtin:')).lastIndexOf(false);
    expect(firstBuiltinIdx).toBeGreaterThan(lastScannedIdx);
  });

  it('GET /api/skills?search applies filter to built-ins', async () => {
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills?search=code%20review'),
    );
    const body = readJson(res) as { skills: { id: string }[] };
    expect(body.skills.some((s) => s.id === 'builtin:code-review')).toBe(true);
    expect(body.skills.some((s) => s.id === 'builtin:release-notes')).toBe(false);
  });

  it('GET /api/skills?dir=other excludes built-ins; dir=builtin includes them', async () => {
    {
      const res = mkRes();
      await handleSkills(
        mkReq('GET'),
        res as unknown as ServerResponse,
        new URL('http://x/api/skills?dir=.claude/skills'),
      );
      const body = readJson(res) as { skills: { id: string }[] };
      expect(body.skills.some((s) => s.id.startsWith('builtin:'))).toBe(false);
    }
    {
      const res = mkRes();
      await handleSkills(
        mkReq('GET'),
        res as unknown as ServerResponse,
        new URL('http://x/api/skills?dir=builtin'),
      );
      const body = readJson(res) as { skills: { id: string }[] };
      expect(body.skills.every((s) => s.id.startsWith('builtin:'))).toBe(true);
    }
  });

  it('GET /api/skills/builtin:code-review returns built-in body', async () => {
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL(`http://x/api/skills/${encodeURIComponent('builtin:code-review')}`),
    );
    expect(res.statusCode).toBe(200);
    const body = readJson(res) as { skill: { id: string; body: string; absPath: string } };
    expect(body.skill.id).toBe('builtin:code-review');
    expect(body.skill.body.length).toBeGreaterThan(0);
    expect(body.skill.absPath).toBe('(built-in)');
  });

  it('PUT /api/skills/builtin:code-review returns 400', async () => {
    const res = mkRes();
    await handleSkills(
      mkReq('PUT', { description: 'new' }),
      res as unknown as ServerResponse,
      new URL(`http://x/api/skills/${encodeURIComponent('builtin:code-review')}`),
    );
    expect(res.statusCode).toBe(400);
    const body = readJson(res) as { error: string };
    expect(body.error).toContain('read-only');
  });

  it('GET /api/skills/dirs includes "builtin"', async () => {
    upsertSkillIndex(dbOrFail(), PROJECT_CODE, [
      mkSkill('a', '.claude/skills/a/SKILL.md'),
    ]);
    const res = mkRes();
    await handleSkills(
      mkReq('GET'),
      res as unknown as ServerResponse,
      new URL('http://x/api/skills/dirs'),
    );
    const body = readJson(res) as { dirs: string[] };
    expect(body.dirs).toContain('builtin');
  });

  it('GET /api/skills/scan/events writes SSE handshake and initial event', async () => {
    const res = mkRes();
    const req = mkReq('GET');
    await handleSkills(
      req,
      res as unknown as ServerResponse,
      new URL('http://x/api/skills/scan/events'),
    );
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['Content-Type'] ?? '')).toContain('text/event-stream');
    const written = Buffer.concat(res.chunks).toString('utf8');
    expect(written).toContain('agentboard skill-scan SSE ready');

    // Trigger cleanup to release the heartbeat interval.
    req.emit('close');
  });
});
