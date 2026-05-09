#!/usr/bin/env node
/**
 * Copilot CLI installer for agentboard.
 *
 * Copilot CLI has no plugin manifest, so this is a custom installer that
 * wires up three independent extension surfaces:
 *
 *   1. ~/.copilot/mcp-config.json — merge agentboard MCP server entry.
 *      (Path overridable via COPILOT_HOME.)
 *   2. <target-repo>/.github/hooks/agentboard.json — drop hook config that
 *      runs ./hooks/session/hook-runner.mjs on sessionStart, postToolUse,
 *      and userPromptSubmitted.
 *   3. <target-repo>/AGENTS.md — append a stanza describing the agentboard
 *      MCP tools so Copilot's prompt context picks it up. (Optional.)
 *
 * Usage:
 *   node plugins/copilot/install.mjs [--repo /path/to/repo] [--no-agents-md]
 *
 * Defaults:
 *   --repo defaults to process.cwd().
 *   COPILOT_HOME defaults to ~/.copilot.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

function atomicWrite(path, contents) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, "utf-8");
  renameSync(tmp, path);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = HERE;
const REPO_ROOT = resolve(HERE, "..", "..");
const HOOK_RUNNER = resolve(PLUGIN_ROOT, "hooks", "session", "hook-runner.mjs");
const SHARED_MCP = resolve(REPO_ROOT, "plugins", "claude-code", "mcp", "agentboard.mjs");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  if (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return true;
}

const targetRepo = resolve(arg("repo", process.cwd()));
// --no-agents-md is a pure boolean flag; presence disables the AGENTS.md step.
const writeAgentsMd = !process.argv.includes("--no-agents-md");
const dryRun = process.argv.includes("--dry-run");
const copilotHome = process.env.COPILOT_HOME || join(homedir(), ".copilot");
const mcpConfigPath = join(copilotHome, "mcp-config.json");
const repoHooksDir = join(targetRepo, ".github", "hooks");
const repoHookFile = join(repoHooksDir, "agentboard.json");
const agentsMdPath = join(targetRepo, "AGENTS.md");

console.log("agentboard — Copilot CLI installer");
console.log(`  plugin root : ${PLUGIN_ROOT}`);
console.log(`  target repo : ${targetRepo}`);
console.log(`  COPILOT_HOME: ${copilotHome}`);
console.log(`  dry-run     : ${dryRun}`);
console.log("");

if (!existsSync(SHARED_MCP)) {
  console.error(
    `[!] cannot find shared MCP server at ${SHARED_MCP}. ` +
      `The agentboard claude-code plugin must be installed alongside this one. Aborting.`,
  );
  process.exit(1);
}

let changed = 0;

// 1. MCP config merge — best-effort; failures don't abort the rest.
try {
  mkdirSync(copilotHome, { recursive: true });
  let cfg = { mcpServers: {} };
  let parseFailed = false;
  if (existsSync(mcpConfigPath)) {
    try {
      cfg = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
      if (!cfg || typeof cfg !== "object") cfg = { mcpServers: {} };
      if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
    } catch (e) {
      console.error(
        `[!] could not parse existing ${mcpConfigPath} (${e?.message ?? e}). ` +
          `Skipping MCP merge so the file is not overwritten.`,
      );
      parseFailed = true;
    }
  }
  if (!parseFailed) {
    const cur = cfg.mcpServers.agentboard;
    const argsArr = Array.isArray(cur?.args) ? cur.args : [];
    // Looser idempotency: keep user's extra args/env, only rewrite when the
    // command or first arg drifts from what we expect.
    const same = cur && cur.command === "node" && argsArr[0] === SHARED_MCP;
    if (!same) {
      cfg.mcpServers.agentboard = { ...(cur ?? {}), command: "node", args: [SHARED_MCP, ...argsArr.slice(1)] };
      const out = JSON.stringify(cfg, null, 2) + "\n";
      if (dryRun) {
        console.log(`[dry-run] would write agentboard entry to ${mcpConfigPath}`);
      } else {
        atomicWrite(mcpConfigPath, out);
        console.log(`[+] wrote agentboard entry to ${mcpConfigPath}`);
        changed++;
      }
    } else {
      console.log(`[=] ${mcpConfigPath} already has agentboard entry`);
    }
  }
} catch (e) {
  console.error(`[!] mcp-config step failed: ${e?.message ?? e}`);
}

// 2. Repo hook config drop
try {
  mkdirSync(repoHooksDir, { recursive: true });
  const tmpl = readFileSync(join(PLUGIN_ROOT, "templates", "agentboard.json.tmpl"), "utf-8");
  const filled = tmpl.replaceAll("__HOOK_RUNNER__", HOOK_RUNNER.replace(/\\/g, "/"));
  if (existsSync(repoHookFile)) {
    const cur = readFileSync(repoHookFile, "utf-8");
    if (cur.trim() === filled.trim()) {
      console.log(`[=] ${repoHookFile} already up-to-date`);
    } else if (dryRun) {
      console.log(`[dry-run] would update ${repoHookFile}`);
    } else {
      atomicWrite(repoHookFile, filled);
      console.log(`[+] updated ${repoHookFile}`);
      changed++;
    }
  } else if (dryRun) {
    console.log(`[dry-run] would write ${repoHookFile}`);
  } else {
    atomicWrite(repoHookFile, filled);
    console.log(`[+] wrote ${repoHookFile}`);
    changed++;
  }
} catch (e) {
  console.error(`[!] hook drop step failed: ${e?.message ?? e}`);
}

// 3. AGENTS.md appendix
if (writeAgentsMd) {
  try {
    const stanza = [
      "",
      "## agentboard MCP",
      "",
      "This repo has an agentboard MCP server registered (`agentboard`).",
      "Use its tools to inspect and drive the local kanban board:",
      "`get_board`, `get_task`, `list_runs`, `dispatch_task`, `approve_task`,",
      "`reject_task`. The MCP server reads from `~/.agentboard/`.",
      "",
    ].join("\n");
    let body = "";
    if (existsSync(agentsMdPath)) body = readFileSync(agentsMdPath, "utf-8");
    if (!body.includes("## agentboard MCP")) {
      if (dryRun) {
        console.log(`[dry-run] would append agentboard stanza to ${agentsMdPath}`);
      } else {
        atomicWrite(agentsMdPath, body + stanza);
        console.log(`[+] appended agentboard stanza to ${agentsMdPath}`);
        changed++;
      }
    } else {
      console.log(`[=] ${agentsMdPath} already mentions agentboard`);
    }
  } catch (e) {
    console.error(`[!] AGENTS.md step failed: ${e?.message ?? e}`);
  }
}

console.log("");
console.log(changed > 0 ? `done — ${changed} file(s) modified.` : "done — no changes needed.");
console.log("");
console.log("Next:");
console.log("  • Restart Copilot CLI so it re-reads ~/.copilot/mcp-config.json.");
console.log("  • Boot the agentboard server once: node plugins/claude-code/bin/ensure-server.ts");
console.log("  • In Copilot CLI, /mcp should now list `agentboard` tools.");
