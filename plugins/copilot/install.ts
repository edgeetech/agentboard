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

// Sentinels delimit the agentboard stanza in AGENTS.md so uninstall can
// exact-match and remove it without depending on neighbouring heading levels.
const STANZA_BEGIN = "<!-- agentboard:begin -->";
const STANZA_END = "<!-- agentboard:end -->";

/**
 * Read a value-taking option like `--repo /path`. If the option is missing,
 * or its next token is itself a flag (starts with "-"), or there is no next
 * token, fall back to `def` instead of silently consuming a flag or the
 * literal string "true".
 */
function optionString(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  if (typeof next !== "string" || next.startsWith("-")) {
    console.error(
      `[!] --${name} requires a value; got "${next ?? "(end of args)"}". Falling back to default "${def}".`,
    );
    return def;
  }
  return next;
}

const targetRepo: string = resolve(optionString("repo", process.cwd()));
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
if (!existsSync(HOOK_RUNNER)) {
  console.error(
    `[!] cannot find hook runner at ${HOOK_RUNNER}. ` +
      `Repo hook template would point at a missing file. Aborting.`,
  );
  process.exit(1);
}

let changed = 0;

// 1. MCP config merge — best-effort; failures don't abort the rest.
try {
  if (!dryRun) mkdirSync(copilotHome, { recursive: true });
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
    // The "script path slot" is the first non-flag arg (leading "-" entries
    // are Node flags like --experimental-strip-types). The entry is already
    // up-to-date iff that slot equals SHARED_MCP.
    const scriptIdx = argsArr.findIndex(
      (a) => typeof a !== "string" || !a.startsWith("-"),
    );
    const same = !!cur && scriptIdx !== -1 && argsArr[scriptIdx] === SHARED_MCP;
    if (!same) {
      // Replace only the script slot, preserving leading flags and trailing
      // script-args. If there is no non-flag slot (e.g. args is empty or all
      // flags), append SHARED_MCP after the flags.
      let nextArgs: unknown[];
      if (scriptIdx === -1) {
        nextArgs = [...argsArr, SHARED_MCP];
      } else {
        nextArgs = [
          ...argsArr.slice(0, scriptIdx),
          SHARED_MCP,
          ...argsArr.slice(scriptIdx + 1),
        ];
      }
      if (cur && cur.command !== "node") {
        console.log(
          `[!] preserving user-modified command "${cur.command}" on existing agentboard entry`,
        );
      }
      cfg.mcpServers.agentboard = {
        ...(cur ?? { command: "node" }),
        command: cur?.command ?? "node",
        args: nextArgs,
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
  if (!dryRun) mkdirSync(repoHooksDir, { recursive: true });
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
    const stanzaLines = [
      STANZA_BEGIN,
      "## agentboard MCP",
      "",
      "This repo has an agentboard MCP server registered (`agentboard`).",
      "Use its tools to inspect and drive the local kanban board:",
      "`get_board`, `get_task`, `list_runs`, `dispatch_task`, `approve_task`,",
      "`reject_task`. The MCP server reads from `~/.agentboard/`.",
      STANZA_END,
      "",
    ];
    let body = "";
    if (existsSync(agentsMdPath)) body = readFileSync(agentsMdPath, "utf-8");
    // Match either the new sentinel marker or the legacy heading so we don't
    // double-append on top of a pre-sentinel install.
    const alreadyInstalled = body.includes(STANZA_BEGIN) || body.includes("## agentboard MCP");
    if (!alreadyInstalled) {
      // Join order avoids leading blank line on fresh files: separator first,
      // then the stanza body; on empty body the separator is dropped.
      const separator = body.length === 0 ? "" : body.endsWith("\n") ? "\n" : "\n\n";
      const out = body + separator + stanzaLines.join("\n");
      if (dryRun) {
        console.log(`[dry-run] would append agentboard stanza to ${agentsMdPath}`);
      } else {
        atomicWrite(agentsMdPath, out);
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
