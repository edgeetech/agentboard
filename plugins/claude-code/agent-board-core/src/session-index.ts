// In-memory index of recorded sessions across every session DB directory.
//
// Design goals (the Sessions page used to freeze the whole server):
//  - Never read session DBs on the HTTP event loop. Scans run in a worker
//    thread; the in-process fallback yields between files.
//  - Incremental: files are re-read only when their size/mtime (incl. WAL)
//    changes, so steady-state requests cost a few stat() calls.
//  - Stale-while-revalidate: requests are answered from the current snapshot
//    immediately and report `indexing` so the UI can show progress.
//  - Paging, filtering and search happen server-side over the snapshot.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  getReadOpener,
  hashOf,
  listDbFileNames,
  readSessionSummaries,
  type SessionDbOpener,
  type SessionSummary,
} from './session-store.ts';

export interface SessionFileRef {
  path: string;
  hash: string;
}

export interface SessionFileResult extends SessionFileRef {
  sessions: SessionSummary[];
  error: string | null;
}

export interface SessionScanRequest {
  files: SessionFileRef[];
}

export type SessionScanner = (
  files: readonly SessionFileRef[],
  onResult: (result: SessionFileResult) => void,
) => Promise<void>;

export interface SessionLink {
  taskCode: string | null;
  role: string | null;
  provider: string;
  repoPath: string | null;
  projectCode: string;
}

export type SessionSource = 'agentboard' | 'cli';
export type SessionSourceFilter = 'all' | SessionSource;

export interface SessionListItem extends SessionSummary {
  source: SessionSource;
  taskCode: string | null;
  projectCode: string | null;
  provider: string;
  repoPath: string | null;
}

export interface SessionQuery {
  q?: string | undefined;
  source?: SessionSourceFilter | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export interface SessionPage {
  items: SessionListItem[];
  /** Matches for the current filter + search, before paging. */
  total: number;
  nextOffset: number | null;
  counts: Record<SessionSourceFilter, number>;
  stats: { sessions: number; events: number; avgDurationMin: number; dbs: number };
  indexing: boolean;
  progress: { indexed: number; total: number };
  indexedAt: string | null;
  dirs: string[];
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

// ─── scanning ─────────────────────────────────────────────────────────────

export function scanSessionFile(
  open: SessionDbOpener | null,
  file: SessionFileRef,
): SessionFileResult {
  if (!open) return { ...file, sessions: [], error: 'sqlite adapter unavailable' };
  let db: ReturnType<SessionDbOpener> | undefined;
  try {
    db = open(file.path);
    return { ...file, sessions: readSessionSummaries(db, file.hash), error: null };
  } catch (e) {
    return { ...file, sessions: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      db?.close();
    } catch {
      /* best effort */
    }
  }
}

const yieldToLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/** Main-thread scanner that yields to the event loop between files. */
export function inProcessScanner(): SessionScanner {
  return async (files, onResult) => {
    const open = await getReadOpener();
    for (const file of files) {
      onResult(scanSessionFile(open, file));
      await yieldToLoop();
    }
  };
}

function canRunTypeScriptWorker(): boolean {
  const features = process.features as { typescript?: unknown };
  return (
    Boolean(features.typescript) ||
    process.execArgv.some((arg) => arg.includes('strip-types') || arg.includes('transform-types'))
  );
}

/**
 * Scans in a short-lived worker thread. Any worker failure (unsupported
 * runtime, crash) falls back to the in-process scanner for the files that did
 * not come back, so the index always completes.
 */
export function workerScanner(fallback: SessionScanner = inProcessScanner()): SessionScanner {
  return (files, onResult) => {
    if (files.length === 0) return Promise.resolve();
    if (!canRunTypeScriptWorker()) return fallback(files, onResult);

    return new Promise<void>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./session-index-worker.ts', import.meta.url));
      } catch {
        void fallback(files, onResult).then(resolve, resolve);
        return;
      }
      const done = new Set<string>();
      let settled = false;
      const settle = (failed: boolean): void => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        if (!failed) {
          resolve();
          return;
        }
        const rest = files.filter((f) => !done.has(f.path));
        void fallback(rest, onResult).then(resolve, resolve);
      };
      worker.on(
        'message',
        (msg: { kind: 'file'; result: SessionFileResult } | { kind: 'done' }) => {
          if (msg.kind === 'file') {
            done.add(msg.result.path);
            onResult(msg.result);
          } else {
            settle(false);
          }
        },
      );
      worker.on('error', () => {
        settle(true);
      });
      worker.on('exit', () => {
        settle(true);
      });
      const request: SessionScanRequest = { files: [...files] };
      worker.postMessage(request);
    });
  };
}

// ─── index ────────────────────────────────────────────────────────────────

interface CachedFile {
  hash: string;
  dirIndex: number;
  fingerprint: string;
  sessions: SessionSummary[];
}

interface FileStat extends SessionFileRef {
  dirIndex: number;
  fingerprint: string;
  mtimeMs: number;
}

export interface SessionIndexOptions {
  dirs: () => string[];
  scanner: SessionScanner;
  links: () => Promise<Map<string, SessionLink>>;
  /** Minimum ms between directory re-checks. */
  staleMs?: number;
  /** ms to cache the AgentBoard run→session link map. */
  linkTtlMs?: number;
  now?: () => number;
}

async function statFile(dir: string, name: string, dirIndex: number): Promise<FileStat | null> {
  const path = join(dir, name);
  try {
    const main = await stat(path);
    // WAL-mode writers touch `-wal`, not the main file, until checkpoint.
    const wal = await stat(`${path}-wal`).catch(() => null);
    const mtimeMs = Math.max(main.mtimeMs, wal?.mtimeMs ?? 0);
    return {
      path,
      hash: hashOf(name),
      dirIndex,
      mtimeMs,
      fingerprint: `${main.size}:${wal?.size ?? 0}:${mtimeMs}`,
    };
  } catch {
    return null;
  }
}

function durationMin(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null;
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 60_000));
}

export class SessionIndex {
  private readonly opts: Required<SessionIndexOptions>;
  private readonly files = new Map<string, CachedFile>();
  private refreshing: Promise<void> | null = null;
  /** True only while changed files are being read (not during stat checks). */
  private scanning = false;
  private lastCheckAt = Number.NEGATIVE_INFINITY;
  private indexedAt: number | null = null;
  private progress = { indexed: 0, total: 0 };
  private sorted: SessionSummary[] | null = null;
  private linkCache: { at: number; map: Map<string, SessionLink> } | null = null;
  private itemsMemo: {
    sorted: SessionSummary[];
    links: Map<string, SessionLink>;
    items: SessionListItem[];
    /** Lower-cased search text, index-aligned with `items`. */
    haystacks: string[];
    counts: Record<SessionSourceFilter, number>;
    stats: SessionPage['stats'];
  } | null = null;

  constructor(opts: SessionIndexOptions) {
    this.opts = { staleMs: 10_000, linkTtlMs: 10_000, now: Date.now, ...opts };
  }

  /** Drop cached link data and force the next query to re-check files. */
  invalidate(): void {
    this.lastCheckAt = Number.NEGATIVE_INFINITY;
    this.linkCache = null;
  }

  /** Coalesced background refresh. Resolves when the scan finishes. */
  refresh(): Promise<void> {
    this.refreshing ??= this.runRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async query(query: SessionQuery = {}, opts: { waitMs?: number } = {}): Promise<SessionPage> {
    if (this.opts.now() - this.lastCheckAt >= this.opts.staleMs) void this.refresh();
    // On a cold start give the first files a moment to land so the first
    // paint is usually populated; never block on the full scan.
    if (this.refreshing && this.indexedAt === null) {
      const waitMs = opts.waitMs ?? 400;
      await Promise.race([
        this.refreshing,
        new Promise((resolve) => {
          setTimeout(resolve, waitMs).unref();
        }),
      ]);
    }

    const { items: all, haystacks, counts, stats } = await this.snapshot();

    const source = query.source ?? 'all';
    const needle = (query.q ?? '').trim().toLowerCase();
    const matches = all.filter(
      (s, i) =>
        (source === 'all' || s.source === source) &&
        (needle === '' || (haystacks[i] ?? '').includes(needle)),
    );
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = Math.max(0, query.offset ?? 0);
    const items = matches.slice(offset, offset + limit);

    return {
      items,
      total: matches.length,
      nextOffset: offset + items.length < matches.length ? offset + items.length : null,
      counts,
      stats,
      indexing: this.scanning || (this.refreshing !== null && this.indexedAt === null),
      progress: { ...this.progress },
      indexedAt: this.indexedAt === null ? null : new Date(this.indexedAt).toISOString(),
      dirs: this.opts.dirs(),
    };
  }

  /** Joined list items, recomputed only when files or links change. */
  private async snapshot(): Promise<NonNullable<SessionIndex['itemsMemo']>> {
    const links = await this.getLinks();
    const sorted = this.sortedSessions();
    if (this.itemsMemo?.sorted === sorted && this.itemsMemo.links === links) return this.itemsMemo;
    const items = sorted.map((s) => this.toItem(s, links));
    const counts: Record<SessionSourceFilter, number> = {
      all: items.length,
      agentboard: 0,
      cli: 0,
    };
    for (const s of items) counts[s.source] += 1;
    const haystacks = items.map(searchText);
    this.itemsMemo = { sorted, links, items, haystacks, counts, stats: this.stats(items) };
    return this.itemsMemo;
  }

  /** AgentBoard link for one session id (detail view). */
  async linkFor(sessionId: string): Promise<SessionLink | undefined> {
    return (await this.getLinks()).get(sessionId);
  }

  private async runRefresh(): Promise<void> {
    this.lastCheckAt = this.opts.now();
    const dirs = this.opts.dirs();
    const stats = (
      await Promise.all(
        dirs.flatMap((dir, dirIndex) =>
          listDbFileNames(dir).map((name) => statFile(dir, name, dirIndex)),
        ),
      )
    ).filter((s): s is FileStat => s !== null);

    const present = new Set(stats.map((s) => s.path));
    for (const path of [...this.files.keys()]) {
      if (!present.has(path)) {
        this.files.delete(path);
        this.sorted = null;
      }
    }

    // Most recently active DBs first so the top of the list fills in fastest.
    const changed = stats
      .filter((s) => this.files.get(s.path)?.fingerprint !== s.fingerprint)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const byPath = new Map(changed.map((s) => [s.path, s]));
    this.progress = { indexed: stats.length - changed.length, total: stats.length };

    this.scanning = changed.length > 0;
    try {
      await this.scan(changed, byPath);
    } finally {
      this.scanning = false;
    }
    this.indexedAt = this.opts.now();
  }

  private async scan(changed: FileStat[], byPath: Map<string, FileStat>): Promise<void> {
    await this.opts.scanner(
      changed.map(({ path, hash }) => ({ path, hash })),
      (result) => {
        const meta = byPath.get(result.path);
        if (!meta) return;
        this.files.set(result.path, {
          hash: result.hash,
          dirIndex: meta.dirIndex,
          fingerprint: meta.fingerprint,
          sessions: result.sessions,
        });
        this.sorted = null;
        this.progress.indexed += 1;
      },
    );
  }

  private sortedSessions(): SessionSummary[] {
    if (this.sorted) return this.sorted;
    // The same session can be recorded by both AgentBoard and context-mode;
    // keep the copy from the higher-priority dir, then the richer one.
    const best = new Map<string, { s: SessionSummary; dirIndex: number }>();
    for (const file of this.files.values()) {
      for (const s of file.sessions) {
        const prev = best.get(s.id);
        if (
          !prev ||
          file.dirIndex < prev.dirIndex ||
          (file.dirIndex === prev.dirIndex && s.eventCount > prev.s.eventCount)
        ) {
          best.set(s.id, { s, dirIndex: file.dirIndex });
        }
      }
    }
    this.sorted = [...best.values()]
      .map((v) => v.s)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    return this.sorted;
  }

  private async getLinks(): Promise<Map<string, SessionLink>> {
    const now = this.opts.now();
    if (this.linkCache && now - this.linkCache.at < this.opts.linkTtlMs) return this.linkCache.map;
    const map = await this.opts.links().catch(() => new Map<string, SessionLink>());
    this.linkCache = { at: now, map };
    return map;
  }

  private toItem(s: SessionSummary, links: Map<string, SessionLink>): SessionListItem {
    const link = links.get(s.id);
    return {
      ...s,
      role: s.role ?? link?.role ?? null,
      source: link ? 'agentboard' : 'cli',
      taskCode: link?.taskCode ?? null,
      projectCode: link?.projectCode ?? null,
      provider: link?.provider ?? 'claude',
      repoPath: link?.repoPath ?? null,
    };
  }

  private stats(all: SessionListItem[]): SessionPage['stats'] {
    let events = 0;
    let durTotal = 0;
    let durCount = 0;
    for (const s of all) {
      events += s.eventCount;
      const d = durationMin(s.startedAt, s.lastEventAt);
      if (d !== null) {
        durTotal += d;
        durCount += 1;
      }
    }
    const dbs = new Set<string>();
    for (const f of this.files.values()) if (f.sessions.length > 0) dbs.add(f.hash);
    return {
      sessions: all.length,
      events,
      avgDurationMin: durCount === 0 ? 0 : Math.round(durTotal / durCount),
      dbs: dbs.size,
    };
  }
}

// Unit separator keeps a needle from matching across two adjacent fields.
const FIELD_SEPARATOR = '\u001f';

function searchText(s: SessionListItem): string {
  return [s.id, s.projectDir, s.firstPrompt, s.intent, s.role, s.taskCode, s.dbHash]
    .filter((v): v is string => v !== null)
    .join(FIELD_SEPARATOR)
    .toLowerCase();
}
