#!/usr/bin/env node
import "./suppress-stderr.mjs";
/**
 * PostToolUse session recorder. Ported from context-mode.
 * Silent on all errors — must never block the session.
 */
import { readStdin, getSessionId, getSessionDBPath, getProjectDir } from "./session-helpers.mjs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

try {
  const raw = await readStdin();
  const input = JSON.parse(raw);

  const { SessionDB } = await import(pathToFileURL(join(HOOK_DIR, "session-db.bundle.mjs")).href);
  const { extractEvents } = await import(pathToFileURL(join(HOOK_DIR, "session-extract.bundle.mjs")).href);

  const db = new SessionDB({ dbPath: getSessionDBPath() });
  const sessionId = getSessionId(input);
  db.ensureSession(sessionId, getProjectDir());

  const events = extractEvents({
    tool_name: input.tool_name,
    tool_input: input.tool_input ?? {},
    tool_response: typeof input.tool_response === "string"
      ? input.tool_response
      : JSON.stringify(input.tool_response ?? ""),
    tool_output: input.tool_output,
  });

  for (const event of events) db.insertEvent(sessionId, event, "PostToolUse");
  db.close();
} catch {
  // swallow — session recording is best-effort
}
