#!/usr/bin/env node
import "./suppress-stderr.mjs";
/**
 * SessionStart session recorder. Minimal port from context-mode — we only
 * seed the session_meta row + capture CLAUDE.md rule files; no "rules of
 * engagement" directive injection (that's context-mode's domain). Silent.
 */
import { readStdin, getSessionId, getSessionDBPath, getProjectDir, shouldRunFreshStartChores } from "./session-helpers.mjs";
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
  const { resolveAttribution } = await import(pathToFileURL(join(HOOK_DIR, "project-attribution.ts")).href);
  const db = new SessionDB({ dbPath: getSessionDBPath() });
  const sessionId = getSessionId(input);
  // Use the higher-confidence project attribution when available; fall back
  // to process cwd. session_meta.project_dir only stores one value, so we
  // pick the best signal we have at session-start time.
  const attribution = resolveAttribution({
    input,
    sessionOrigin: null,
    lastSeen: null,
    processCwd: getProjectDir(),
  });
  const projectDir = attribution.projectDir;
  db.ensureSession(sessionId, projectDir);

  if (source === "startup") {
    // Only once-per-N-hours, not on every --continue / --resume.
    if (shouldRunFreshStartChores()) {
      try { db.cleanupOldSessions(7); } catch {}
    }
    // Detect well-known agent rule files across editors. Each match writes
    // a `rule` event (path) and a `rule_content` event (body).
    const rulePaths = [
      // Claude Code
      join(homedir(), ".claude", "CLAUDE.md"),
      join(projectDir, "CLAUDE.md"),
      join(projectDir, ".claude", "CLAUDE.md"),
      // Cross-tool conventions
      join(projectDir, "AGENTS.md"),
      join(projectDir, "GEMINI.md"),
      join(projectDir, "QWEN.md"),
      join(projectDir, "KIRO.md"),
      join(projectDir, ".github", "copilot-instructions.md"),
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
