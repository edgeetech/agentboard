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

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

try {
  const raw = await readStdin();
  const input = raw ? JSON.parse(raw) : {};

  const { SessionDB } = await import(
    pathToFileURL(join(HOOK_DIR, "session-db.bundle.mjs")).href
  );
  const db = new SessionDB({ dbPath: getSessionDBPath() });
  const sessionId = getSessionId(input);
  db.ensureSession(sessionId, getProjectDir());
  db.incrementCompactCount(sessionId);
  // Capture a low-priority breadcrumb so the timeline shows the compaction.
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
