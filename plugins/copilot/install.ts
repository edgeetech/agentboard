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
 *      runs ./hooks/session/hook-runner.ts on sessionStart, postToolUse,
 *      and userPromptSubmitted.
 *   3. <target-repo>/AGENTS.md — append a stanza describing the agentboard
 *      MCP tools so Copilot's prompt context picks it up. (Optional.)
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings plugins/copilot/install.ts \
 *        [--repo /path/to/repo] [--no-agents-md] [--dry-run]
 *
 * Defaults:
 *   --repo defaults to process.cwd().
 *   COPILOT_HOME defaults to ~/.copilot.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

interface MCPEntry {
  command: string;
  args?: unknown[];
  env?: Record<string, string>;
  [k: string]: unknown;
}

interface MCPConfig {
  mcpServers: Record<string, MCPEntry>;
  [k: string]: unknown;
}

function atomicWrite(path: string, contents: string): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, "utf-8");
  renameSync(tmp, path);
}

const HERE: string = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT: string = HERE;
const REPO_ROOT: string = resolve(HERE, "..", "..");
const HOOK_RUNNER: string = resolve(PLUGIN_ROOT, "hooks", "session", "hook-runner.ts");
const SHARED_MCP: string = resolve(REPO_ROOT, "plugins", "claude-code", "mcp", "agentboard.mjs");

function arg(name: string, def: string | boolean): string | boolean {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  if (typeof next === "string" && !next.startsWith("--")) return next;
  return true;
}

const targetRepo: string = resolve(String(arg("repo", process.cwd())));
const writeAgentsMd: boolean = !process.argv.includes("--no-agents-md");
const dryRun: boolean = process.argv.includes("--dry-run");
const copilotHome: string = process.env.COPILOT_HOME || join(homedir(), ".copilot");
const mcpConfigPath: string = join(copilotHome, "mcp-config.json");
const repoHooksDir: string = join(targetRepo, ".github", "hooks");
const repoHookFile: string = join(repoHooksDir, "agentboard.json");
const agentsMdPath: string = join(targetRepo, "AGENTS.md");

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
  let cfg: MCPConfig = { mcpServers: {} };
  let parseFailed = false;
  if (existsSync(mcpConfigPath)) {
    try {
      const parsed = JSON.parse(readFileSync(mcpConfigPath, "utf-8")) as Partial<MCPConfig>;
      cfg = (parsed && typeof parsed === "object")
        ? { ...parsed, mcpServers: (parsed.mcpServers && typeof parsed.mcpServers === "object") ? parsed.mcpServers : {} }
        : { mcpServers: {} };
    } catch (e) {
      console.error(
        `[!] could not parse existing ${mcpConfigPath} (${(e as Error)?.message ?? e}). ` +
          `Skipping MCP merge so the file is not overwritten.`,
      );
      parseFailed = true;
    }
  }
  if (!parseFailed) {
    const cur = cfg.mcpServers.agentboard;
    const argsArr: unknown[] = Array.isArray(cur?.args) ? cur.args : [];
    const same = !!cur && cur.command === "node" && argsArr[0] === SHARED_MCP;
    if (!same) {
      cfg.mcpServers.agentboard = {
        ...(cur ?? { command: "node" }),
        command: "node",
        args: [SHARED_MCP, ...argsArr.slice(1)],
      };
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
  console.error(`[!] mcp-config step failed: ${(e as Error)?.message ?? e}`);
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
  console.error(`[!] hook drop step failed: ${(e as Error)?.message ?? e}`);
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
    console.error(`[!] AGENTS.md step failed: ${(e as Error)?.message ?? e}`);
  }
}

console.log("");
console.log(changed > 0 ? `done — ${changed} file(s) modified.` : "done — no changes needed.");
console.log("");
console.log("Next:");
console.log("  • Restart Copilot CLI so it re-reads ~/.copilot/mcp-config.json.");
console.log("  • Boot the agentboard server once: node --experimental-strip-types plugins/claude-code/bin/ensure-server.ts");
console.log("  • In Copilot CLI, /mcp should now list `agentboard` tools.");
