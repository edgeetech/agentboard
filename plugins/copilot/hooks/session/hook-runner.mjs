#!/usr/bin/env node
/**
 * Copilot CLI hook runner for agentboard.
 *
 * Copilot CLI fires hooks at .github/hooks/*.json with stdin JSON. Event
 * names are camelCase: sessionStart, preToolUse, postToolUse, sessionEnd,
 * userPromptSubmitted. The Copilot stdin schema uses camelCase field names
 * (toolName / toolInput / toolResponse / userPrompt) where the shared
 * Claude/Codex hooks expect snake_case (tool_name / tool_input / etc).
 *
 * This runner:
 *   1. Reads stdin.
 *   2. Normalises camelCase → snake_case (and writes both forms for safety).
 *   3. Spawns the matching shared session hook as a child node process,
 *      piping the normalised JSON in on stdin.
 *
 * Spawning (vs in-process import) avoids re-entry into process.stdin and
 * ensures the shared script's `await readStdin()` sees the transformed
 * payload.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE_HOOKS = resolve(HERE, "..", "..", "..", "claude-code", "hooks", "session");

const eventIdx = process.argv.indexOf("--event");
const event = eventIdx > -1 ? process.argv[eventIdx + 1] : "";

const TARGETS = {
  sessionStart: "sessionstart.mjs",
  postToolUse: "posttooluse.mjs",
  userPromptSubmitted: "userpromptsubmit.mjs",
};

const target = TARGETS[event];
if (!target) {
  // Unknown event — silent no-op so misconfigured hooks never block Copilot.
  process.exit(0);
}

const targetPath = resolve(CLAUDE_HOOKS, target);
if (!existsSync(targetPath)) {
  process.stderr.write(
    `agentboard copilot hook: missing target ${targetPath} — install the agentboard claude-code plugin alongside this repo's hooks.\n`,
  );
  process.exit(0);
}

(async () => {
  const raw = await readStdin();
  const normalised = normaliseCopilotPayload(raw);
  const result = spawnSync(process.execPath, [targetPath], {
    input: normalised,
    encoding: "utf-8",
    stdio: ["pipe", "ignore", "pipe"],
    timeout: 10_000,
  });
  if (process.env.AGENTBOARD_HOOK_DEBUG && result.status !== 0) {
    process.stderr.write(
      `agentboard copilot hook ${event} exit=${result.status} stderr=${result.stderr}\n`,
    );
  }
  process.exit(0);
})();

function readStdin() {
  return new Promise((resolveOk) => {
    let data = "";
    if (process.stdin.isTTY) return resolveOk("");
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolveOk(data.replace(/^﻿/, "")));
    process.stdin.on("error", () => resolveOk(""));
  });
}

function normaliseCopilotPayload(raw) {
  if (!raw) return "{}";
  let obj;
  try { obj = JSON.parse(raw); } catch { return raw; }
  if (!obj || typeof obj !== "object") return raw;

  // Copy through, dual-writing camelCase ↔ snake_case for the keys the
  // shared scripts read. Safe to keep the originals; downstream code
  // ignores fields it doesn't recognise.
  const out = { ...obj };
  copyKey(out, "sessionId", "session_id");
  copyKey(out, "transcriptPath", "transcript_path");
  copyKey(out, "hookEventName", "hook_event_name");
  copyKey(out, "toolName", "tool_name");
  copyKey(out, "toolInput", "tool_input");
  copyKey(out, "toolResponse", "tool_response");
  copyKey(out, "toolOutput", "tool_output");
  // Copilot's user-prompt event sends `userPrompt`; the shared script reads
  // either `prompt` or `message`. Map all three.
  if (out.userPrompt && !out.prompt) out.prompt = out.userPrompt;
  if (out.message && !out.prompt) out.prompt = out.message;
  // SessionStart matcher field. Claude/Codex use `source`.
  if (typeof out.source !== "string" && typeof out.startSource === "string") {
    out.source = out.startSource;
  }
  return JSON.stringify(out);
}

function copyKey(obj, fromKey, toKey) {
  if (obj[fromKey] !== undefined && obj[toKey] === undefined) {
    obj[toKey] = obj[fromKey];
  } else if (obj[toKey] !== undefined && obj[fromKey] === undefined) {
    obj[fromKey] = obj[toKey];
  }
}
