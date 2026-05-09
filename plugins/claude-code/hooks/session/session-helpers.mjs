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
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

// Worktree-suffix cache — two levels:
//   1. Per-process Map keyed by cwd. process.chdir() between calls is rare in
//      one-shot hook invocations, but a long-lived process must not reuse a
//      stale suffix from a different worktree.
//   2. Cross-process: tmpdir marker file keyed by sha256(cwd), TTL 5 min.
// Saves the `git worktree list` subprocess on every hot-path hook fire.
//
// Note: env var changes mid-process are intentionally not picked up — this
// is a one-shot hook process; envs are immutable for our purposes.
const WORKTREE_TTL_MS = 5 * 60 * 1000;
const _worktreeCache = new Map();

function worktreeMarkerPath(cwd) {
  const key = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return join(tmpdir(), `agentboard-worktree-${key}.json`);
}

function getWorktreeSuffix() {
  const envSuffix = process.env.AGENTBOARD_SESSION_SUFFIX;
  if (envSuffix !== undefined) return envSuffix ? `__${envSuffix}` : "";

  const cwd = process.cwd();
  const cached = _worktreeCache.get(cwd);
  if (cached !== undefined) return cached;
  const markerPath = worktreeMarkerPath(cwd);
  // Cross-process cache: tmp marker.
  try {
    if (existsSync(markerPath)) {
      const m = JSON.parse(readFileSync(markerPath, "utf-8"));
      if (m && typeof m.suffix === "string" && m.cwd === cwd
        && typeof m.at === "number"
        && Date.now() - m.at < WORKTREE_TTL_MS) {
        _worktreeCache.set(cwd, m.suffix);
        return m.suffix;
      }
    }
  } catch {}

  let suffix = "";
  try {
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
      suffix = `__${createHash("sha256").update(cwd).digest("hex").slice(0, 8)}`;
    }
  } catch { /* git missing or non-repo */ }

  _worktreeCache.set(cwd, suffix);
  try {
    writeFileSync(
      markerPath,
      JSON.stringify({ suffix, cwd, at: Date.now() }),
      { encoding: "utf-8", mode: 0o600 },
    );
  } catch {}
  return suffix;
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

/**
 * True-fresh-start detection. Claude Code fires SessionStart with
 * source="startup" on both a brand-new session AND every `--continue` /
 * `--resume`. We only want once-a-day chores (e.g. cleanupOldSessions) on
 * the genuinely fresh boot. A sentinel file in tmpdir, refreshed on each
 * fire, lets us tell "first start in the last N hours" from a resume.
 */
const FRESH_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export function getCleanupFlagPath() {
  return join(tmpdir(), "agentboard-cleanup.flag");
}

/**
 * Side-effect: marks the flag fresh on every call. The single permitted caller
 * is sessionstart.mjs — calling this from anywhere else would silently consume
 * the once-per-window token. If you need a read-only check, use
 * `peekFreshStartFlag()`.
 */
export function shouldRunFreshStartChores() {
  const fresh = peekFreshStartFlag();
  try {
    writeFileSync(getCleanupFlagPath(), String(Date.now()), { encoding: "utf-8", mode: 0o600 });
  } catch {}
  return fresh;
}

export function peekFreshStartFlag() {
  const path = getCleanupFlagPath();
  try {
    if (existsSync(path)) {
      const age = Date.now() - statSync(path).mtimeMs;
      if (age < FRESH_TTL_MS) return false;
    }
  } catch {}
  return true;
}

export function clearFreshStartFlag() {
  try { unlinkSync(getCleanupFlagPath()); } catch {}
}
