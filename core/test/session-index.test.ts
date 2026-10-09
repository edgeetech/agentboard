import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  inProcessScanner,
  SessionIndex,
  type SessionFileRef,
  type SessionLink,
  type SessionScanner,
} from '../src/session-index.ts';
import { readSessionDetail, toIsoUtc, type SessionDbHandle } from '../src/session-store.ts';

const SCHEMA = `
  CREATE TABLE session_meta (
    session_id TEXT PRIMARY KEY, project_dir TEXT NOT NULL,
    started_at TEXT NOT NULL, last_event_at TEXT,
    event_count INTEGER NOT NULL DEFAULT 0, compact_count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, type TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'x', priority INTEGER NOT NULL DEFAULT 2, data TEXT NOT NULL,
    source_hook TEXT NOT NULL DEFAULT 'h', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX idx_session_events_type ON session_events(session_id, type);
  CREATE TABLE session_resume (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL,
    event_count INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
`;

interface Fixture {
  id: string;
  started: string;
  events: [type: string, data: string][];
}

function writeDb(path: string, sessions: Fixture[]): void {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  for (const s of sessions) {
    db.prepare(
      `INSERT INTO session_meta (session_id, project_dir, started_at, last_event_at, event_count)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(s.id, `/repo/${s.id}`, s.started, s.started, s.events.length);
    for (const [type, data] of s.events) {
      db.prepare(`INSERT INTO session_events (session_id, type, data) VALUES (?, ?, ?)`).run(
        s.id,
        type,
        data,
      );
    }
  }
  db.close();
}

function countingScanner(): { scanner: SessionScanner; scanned: string[] } {
  const inner = inProcessScanner();
  const scanned: string[] = [];
  return {
    scanned,
    scanner: (files: readonly SessionFileRef[], onResult) => {
      scanned.push(...files.map((f) => f.hash));
      return inner(files, onResult);
    },
  };
}

describe('SessionIndex', () => {
  let root: string;
  let primary: string;
  let legacy: string;
  let links: Map<string, SessionLink>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ab-sessions-'));
    primary = join(root, 'primary');
    legacy = join(root, 'legacy');
    mkdirSync(primary);
    mkdirSync(legacy);
    links = new Map();
    writeDb(join(primary, 'aaa.db'), [
      {
        id: 's1',
        started: '2026-09-01 10:00:00',
        events: [
          ['user_prompt', 'hi'],
          ['user_prompt', 'Fix the flaky login test'],
          ['intent', 'implement'],
          ['role', 'worker'],
        ],
      },
      { id: 's2', started: '2026-09-03 10:00:00', events: [['user_prompt', 'Refactor billing']] },
    ]);
    writeDb(join(legacy, 'bbb.db'), [
      { id: 's2', started: '2026-09-03 10:00:00', events: [] },
      { id: 's3', started: '2026-09-02 10:00:00', events: [['intent', 'investigate']] },
    ]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeIndex(scanner: SessionScanner = inProcessScanner()): SessionIndex {
    return new SessionIndex({
      dirs: () => [primary, legacy],
      scanner,
      links: () => Promise.resolve(links),
      staleMs: 0,
      linkTtlMs: 0,
    });
  }

  it('lists sessions newest first with list-level enrichment and deduped ids', async () => {
    const index = makeIndex();
    await index.refresh();
    const page = await index.query();

    expect(page.items.map((s) => s.id)).toEqual(['s2', 's3', 's1']);
    const s1 = page.items.find((s) => s.id === 's1');
    expect(s1).toMatchObject({
      firstPrompt: 'Fix the flaky login test',
      intent: 'implement',
      role: 'worker',
      startedAt: '2026-09-01T10:00:00Z',
      dbHash: 'aaa',
    });
    // Duplicate s2 resolves to the primary directory copy.
    expect(page.items.find((s) => s.id === 's2')?.dbHash).toBe('aaa');
    expect(page.stats).toMatchObject({ sessions: 3, dbs: 2 });
    expect(page.indexing).toBe(false);
  });

  it('pages, filters by source and searches server-side', async () => {
    links.set('s3', {
      taskCode: 'AB-7',
      role: 'reviewer',
      provider: 'codex',
      repoPath: '/r',
      projectCode: 'AB',
    });
    const index = makeIndex();
    await index.refresh();

    const first = await index.query({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    const second = await index.query({ limit: 2, offset: 2 });
    expect(second.items).toHaveLength(1);
    expect(second.nextOffset).toBeNull();

    const ab = await index.query({ source: 'agentboard' });
    expect(ab.items.map((s) => s.id)).toEqual(['s3']);
    expect(ab.items[0]).toMatchObject({
      taskCode: 'AB-7',
      provider: 'codex',
      source: 'agentboard',
    });
    expect(ab.counts).toEqual({ all: 3, agentboard: 1, cli: 2 });

    expect((await index.query({ q: 'BILLING' })).items.map((s) => s.id)).toEqual(['s2']);
    expect((await index.query({ q: 'ab-7' })).items.map((s) => s.id)).toEqual(['s3']);
  });

  it('only rescans files whose fingerprint changed', async () => {
    const { scanner, scanned } = countingScanner();
    const index = makeIndex(scanner);
    await index.refresh();
    expect(scanned.sort()).toEqual(['aaa', 'bbb']);

    scanned.length = 0;
    await index.refresh();
    expect(scanned).toEqual([]);

    const future = new Date(Date.now() + 60_000);
    utimesSync(join(legacy, 'bbb.db'), future, future);
    await index.refresh();
    expect(scanned).toEqual(['bbb']);
  });

  it('drops sessions from deleted DB files', async () => {
    const index = makeIndex();
    await index.refresh();
    rmSync(join(legacy, 'bbb.db'));
    await index.refresh();
    expect((await index.query()).items.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('answers immediately while a cold scan is still running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: SessionScanner = async (files, onResult) => {
      await gate;
      await inProcessScanner()(files, onResult);
    };
    const index = makeIndex(slow);
    const page = await index.query({}, { waitMs: 5 });
    expect(page.indexing).toBe(true);
    expect(page.items).toEqual([]);
    release();
    await index.refresh();
    expect((await index.query()).items).toHaveLength(3);
  });
});

describe('readSessionDetail', () => {
  it('pages events with a cursor and reports type counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'ab-session-detail-'));
    try {
      const path = join(root, 'x.db');
      writeDb(path, [
        {
          id: 's1',
          started: '2026-09-01 10:00:00',
          events: Array.from({ length: 5 }, (_, i) => ['file_edit', `f${i % 2}.ts`]),
        },
      ]);
      const db = new DatabaseSync(path, { readOnly: true }) as unknown as SessionDbHandle;
      const first = readSessionDetail(db, 's1', { limit: 3 });
      expect(first.events).toHaveLength(3);
      expect(first.hasMore).toBe(true);
      expect(first.totalEvents).toBe(5);
      expect(first.typeCounts).toEqual([{ type: 'file_edit', count: 5 }]);
      expect(first.enrich?.topFiles[0]).toEqual({ path: 'f0.ts', count: 3 });

      const next = readSessionDetail(db, 's1', { after: first.events.at(-1)?.id, limit: 3 });
      expect(next.events).toHaveLength(2);
      expect(next.hasMore).toBe(false);
      expect(next.enrich).toBeNull();
      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes SQLite UTC timestamps to ISO-8601', () => {
    expect(toIsoUtc('2026-09-01 10:00:00')).toBe('2026-09-01T10:00:00Z');
    expect(toIsoUtc('2026-09-01T10:00:00.000Z')).toBe('2026-09-01T10:00:00.000Z');
    expect(toIsoUtc('')).toBeNull();
  });
});
