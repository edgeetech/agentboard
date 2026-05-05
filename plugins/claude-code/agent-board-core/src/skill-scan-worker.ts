// Async skill-scan worker. Per-DB drain loop: each tick, atomically claim
// the next queued scan via skill-repo.claimNextQueuedScan and run it
// fire-and-forget. Single-in-flight per project is enforced by the
// NOT EXISTS guard inside claimNextQueuedScan (skips queued scans whose
// project already has a 'running' scan), so two queued scans for the
// same project run sequentially, not concurrently.

import type { DbHandle } from './db.ts';
import {
  agentboardBus,
  type SkillScanFinishedPayload,
  type SkillScanStartedPayload,
} from './event-bus.ts';
import { getProject } from './repo.ts';
import {
  claimNextQueuedScan,
  type ScanRow,
  updateScan,
  upsertSkillIndex,
} from './skill-repo.ts';
import { scanSkills } from './skill-scanner.ts';
import { isoNow } from './time.ts';

export interface SkillScanWorkerOpts {
  db: DbHandle;
  /** ms between drain polls; default 1000 */
  pollMs?: number;
  /** ms timeout for a single scan; default 60000 */
  scanTimeoutMs?: number;
}

export interface SkillScanWorkerHandle {
  stop: () => Promise<void>;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function safeIgnoreList(json: string | null | undefined): string[] {
  if (json === null || json === undefined || json === '') return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    return [];
  } catch {
    return [];
  }
}

export function startSkillScanWorker(opts: SkillScanWorkerOpts): SkillScanWorkerHandle {
  const { db } = opts;
  const pollMs = opts.pollMs ?? 1000;
  const scanTimeoutMs = opts.scanTimeoutMs ?? 60_000;

  let stopped = false;
  const inflight = new Set<Promise<void>>();

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref();
    });

  async function doScan(claimed: ScanRow): Promise<void> {
    const { id: scanId, projectCode, trigger } = claimed;
    const project = getProject(db);
    const repoPath = project?.repo_path ?? '';
    if (!repoPath) {
      updateScan(db, scanId, {
        status: 'failed',
        endedAt: isoNow(),
        error: 'no repo_path',
      });
      const finished: SkillScanFinishedPayload = {
        scanId,
        projectCode,
        status: 'failed',
        error: 'no repo_path',
      };
      agentboardBus.emit('skill-scan:finished', finished);
      return;
    }

    const userIgnore = safeIgnoreList(project?.scan_ignore_json);

    const started: SkillScanStartedPayload = { scanId, projectCode, trigger };
    agentboardBus.emit('skill-scan:started', started);

    try {
      const scanned = await scanSkills({
        rootDir: repoPath,
        userIgnore,
        timeoutMs: scanTimeoutMs,
      });
      const counts = upsertSkillIndex(db, projectCode, scanned);
      updateScan(db, scanId, {
        status: 'succeeded',
        endedAt: isoNow(),
        foundCount: scanned.length,
        addedCount: counts.added,
        updatedCount: counts.updated,
        removedCount: counts.removed,
      });
      const finished: SkillScanFinishedPayload = {
        scanId,
        projectCode,
        status: 'succeeded',
        counts: {
          added: counts.added,
          updated: counts.updated,
          removed: counts.removed,
          found: scanned.length,
        },
      };
      agentboardBus.emit('skill-scan:finished', finished);
    } catch (e) {
      const msg = errorMessage(e);
      updateScan(db, scanId, {
        status: 'failed',
        endedAt: isoNow(),
        error: msg,
      });
      const finished: SkillScanFinishedPayload = {
        scanId,
        projectCode,
        status: 'failed',
        error: msg,
      };
      agentboardBus.emit('skill-scan:finished', finished);
    }
  }

  function logErr(e: unknown): void {
    console.error('[skill-scan-worker]', (e as Error | null)?.stack ?? e);
  }

  function tick(): void {
    let claimed: ScanRow | null = null;
    try {
      claimed = claimNextQueuedScan(db);
    } catch (e) {
      logErr(e);
      return;
    }
    if (!claimed) return;
    // Fire-and-forget: track promise so stop() can await drain.
    const p = doScan(claimed).catch(logErr);
    const wrapped = p.finally(() => {
      inflight.delete(wrapped);
    });
    inflight.add(wrapped);
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        tick();
      } catch (e) {
        logErr(e);
      }
      await sleep(pollMs);
    }
  }

  const loopPromise = loop();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      await loopPromise.catch(logErr);
      // Wait for any in-flight scans started before stop() to complete.
      while (inflight.size > 0) {
        await Promise.allSettled([...inflight]);
      }
    },
  };
}
