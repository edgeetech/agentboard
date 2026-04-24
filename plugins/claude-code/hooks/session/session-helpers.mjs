/**
 * Session helpers for agentboard's own session recorder.
 *
 * Ported from context-mode (https://github.com/mksglu/context-mode) so agentboard
 * can capture & display Claude Code sessions without depending on context-mode
 * being installed. DB path lives under ~/.agentboard/sessions/ — separate from
 * context-mode's ~/.claude/context-mode/sessions/ to avoid double-writes.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

function getWorktreeSuffix() {
  const envSuffix = process.env.AGENTBOARD_SESSION_SUFFIX;
  if (envSuffix !== undefined) return envSuffix ? `__${envSuffix}` : "";
  try {
    const cwd = process.cwd();
    const mainWorktree = execFileSync(
      "git",
      ["worktree", "list", "--porcelain"],
      { encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
    )
      .split(/\r?\n/)
      .find((l) => l.startsWith("worktree "))
      ?.replace("worktree ", "")
      ?.trim();
    if (mainWorktree && cwd !== mainWorktree) {
      return `__${createHash("sha256").update(cwd).digest("hex").slice(0, 8)}`;
    }
  } catch { /* git missing or non-repo */ }
  return "";
}

export function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data.replace(/^﻿/, "")));
    process.stdin.on("error", reject);
    process.stdin.resume();
  });
}

export function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function getInputProjectDir(input) {
  if (typeof input?.cwd === "string" && input.cwd.length > 0) return input.cwd;
  if (Array.isArray(input?.workspace_roots) && input.workspace_roots.length > 0) {
    return String(input.workspace_roots[0]);
  }
  return getProjectDir();
}

export function getSessionId(input) {
  if (input?.transcript_path) {
    const m = input.transcript_path.match(/([a-f0-9-]{36})\.jsonl$/);
    if (m) return m[1];
  }
  if (input?.conversation_id) return input.conversation_id;
  if (input?.sessionId) return input.sessionId;
  if (input?.session_id) return input.session_id;
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return `pid-${process.ppid}`;
}

/** Directory agentboard owns for its session DBs. */
export function sessionsRootDir() {
  return process.env.AGENTBOARD_SESSION_DIR
    || join(homedir(), ".agentboard", "sessions");
}

export function getSessionDBPath() {
  const projectDir = getProjectDir();
  const hash = createHash("sha256").update(projectDir).digest("hex").slice(0, 16);
  const dir = sessionsRootDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, `${hash}${getWorktreeSuffix()}.db`);
}
