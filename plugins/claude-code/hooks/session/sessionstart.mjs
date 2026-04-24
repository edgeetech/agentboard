#!/usr/bin/env node
import "./suppress-stderr.mjs";
/**
 * SessionStart session recorder. Minimal port from context-mode — we only
 * seed the session_meta row + capture CLAUDE.md rule files; no "rules of
 * engagement" directive injection (that's context-mode's domain). Silent.
 */
import { readStdin, getSessionId, getSessionDBPath, getProjectDir } from "./session-helpers.mjs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

try {
  const raw = await readStdin();
  const input = JSON.parse(raw);
  const source = input.source ?? "startup";

  const { SessionDB } = await import(pathToFileURL(join(HOOK_DIR, "session-db.bundle.mjs")).href);
  const db = new SessionDB({ dbPath: getSessionDBPath() });
  const sessionId = getSessionId(input);
  const projectDir = getProjectDir();
  db.ensureSession(sessionId, projectDir);

  if (source === "startup") {
    try { db.cleanupOldSessions(7); } catch {}
    const rulePaths = [
      join(homedir(), ".claude", "CLAUDE.md"),
      join(projectDir, "CLAUDE.md"),
      join(projectDir, ".claude", "CLAUDE.md"),
    ];
    for (const p of rulePaths) {
      try {
        const content = readFileSync(p, "utf-8");
        if (content.trim()) {
          db.insertEvent(sessionId, { type: "rule", category: "rule", data: p, priority: 1 }, "SessionStart");
          db.insertEvent(sessionId, { type: "rule_content", category: "rule", data: content, priority: 1 }, "SessionStart");
        }
      } catch {}
    }
  }
  db.close();
} catch {
  // swallow
}

// No additionalContext — agentboard doesn't inject into the model.
console.log(JSON.stringify({}));
