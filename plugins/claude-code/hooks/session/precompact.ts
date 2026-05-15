#!/usr/bin/env node
import "./suppress-stderr.mjs";
/**
 * PreCompact session hook. Bumps session_meta.compact_count so the sessions
 * tab can show how many times a long-running session has been compacted.
 * Silent on all errors — must never block the session.
 */
import { readStdin, getSessionId, getSessionDBPath, getProjectDir } from "./session-helpers.mjs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface SessionDBLike {
  ensureSession(id: string, projectDir: string): void;
  incrementCompactCount(id: string): void;
  insertEvent(
    id: string,
    event: { type: string; category: string; priority: number; data: string },
    source: string,
  ): void;
  close(): void;
}

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

try {
  const raw = await readStdin();
  const input: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

  const mod = (await import(
    pathToFileURL(join(HOOK_DIR, "session-db.bundle.mjs")).href
  )) as { SessionDB: new (opts: { dbPath: string }) => SessionDBLike };

  const db = new mod.SessionDB({ dbPath: getSessionDBPath() });
  const sessionId = getSessionId(input);
  db.ensureSession(sessionId, getProjectDir());
  db.incrementCompactCount(sessionId);
  try {
    db.insertEvent(
      sessionId,
      {
        type: "compact",
        category: "lifecycle",
        priority: 1,
        data: JSON.stringify({ at: new Date().toISOString() }),
      },
      "PreCompact",
    );
  } catch {}
  db.close();
} catch {
  // swallow
}

console.log(JSON.stringify({}));
