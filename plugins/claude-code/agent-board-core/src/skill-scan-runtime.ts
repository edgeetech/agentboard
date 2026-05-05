// Process-wide registry for skill-scan worker handles. One worker per
// project DB. Boot wiring lives in server.ts; runtime calls (e.g. when a
// new project is created via POST /api/projects) go through
// `ensureSkillScanWorker` so the new project's queued scans actually drain
// without restarting the server.

import { getDb, listProjectDbs } from './project-registry.ts';
import {
  startSkillScanWorker,
  type SkillScanWorkerHandle,
} from './skill-scan-worker.ts';

const handles = new Map<string, SkillScanWorkerHandle>();

export async function ensureSkillScanWorker(code: string): Promise<void> {
  const lower = code.toLowerCase();
  if (handles.has(lower)) return;
  try {
    const db = await getDb(code);
    const handle = startSkillScanWorker({ db });
    handles.set(lower, handle);
  } catch (e) {
    console.warn(
      '[skill-scan-runtime] could not start worker for',
      code,
      ':',
      (e as Error | null)?.message ?? String(e),
    );
  }
}

export async function startAllSkillScanWorkers(): Promise<void> {
  for (const code of listProjectDbs()) {
    await ensureSkillScanWorker(code);
  }
}

export async function stopAllSkillScanWorkers(): Promise<void> {
  const all = [...handles.values()];
  handles.clear();
  await Promise.all(
    all.map(async (h) => {
      try {
        await h.stop();
      } catch (e) {
        console.warn(
          '[skill-scan-runtime] worker stop failed:',
          (e as Error | null)?.message ?? String(e),
        );
      }
    }),
  );
}

/** Test-only: number of active workers. */
export function activeWorkerCount(): number {
  return handles.size;
}
