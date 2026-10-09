#!/usr/bin/env node
import "./suppress-stderr.mjs";
/**
 * UserPromptSubmit session recorder. Ported from context-mode.
 * Silent on all errors.
 */
import { readStdin, getSessionId, getSessionDBPath, getProjectDir } from "./session-helpers.mjs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

try {
  const raw = await readStdin();
  const input = JSON.parse(raw);

  const prompt = input.prompt ?? input.message ?? "";
  const trimmed = (prompt || "").trim();
  const isSystemMessage = trimmed.startsWith("<task-notification>")
    || trimmed.startsWith("<system-reminder>")
    || trimmed.startsWith("<context_guidance>")
    || trimmed.startsWith("<tool-result>");

  if (trimmed.length > 0 && !isSystemMessage) {
    const { SessionDB } = await import(pathToFileURL(join(HOOK_DIR, "session-db.bundle.mjs")).href);
    const { extractUserEvents } = await import(pathToFileURL(join(HOOK_DIR, "session-extract.bundle.mjs")).href);

    const db = new SessionDB({ dbPath: getSessionDBPath() });
    const sessionId = getSessionId(input);
    db.ensureSession(sessionId, getProjectDir());

    db.insertEvent(sessionId, {
      type: "user_prompt", category: "prompt", data: prompt, priority: 1,
    }, "UserPromptSubmit");

    for (const ev of extractUserEvents(trimmed)) {
      db.insertEvent(sessionId, ev, "UserPromptSubmit");
    }
    db.close();
  }
} catch {
  // swallow
}
