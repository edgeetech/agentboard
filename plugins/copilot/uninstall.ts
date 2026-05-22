#!/usr/bin/env node
/**
 * Copilot CLI uninstaller for agentboard. Reverses what install.ts did:
 *   1. Remove `agentboard` entry from ~/.copilot/mcp-config.json (kept if
 *      file gone or entry already absent).
 *   2. Delete <repo>/.github/hooks/agentboard.json (only the agentboard one).
 *   3. Strip the agentboard stanza from <repo>/AGENTS.md (idempotent).
 *
 * Usage:
 *   node --experimental-strip-types plugins/copilot/uninstall.ts \
 *        [--repo /path/to/repo] [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

interface MCPConfig {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

const STANZA_BEGIN = "<!-- agentboard:begin -->";
const STANZA_END = "<!-- agentboard:end -->";

function atomicWrite(path: string, contents: string): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, "utf-8");
  renameSync(tmp, path);
}

/**
 * Read a value-taking option like `--repo /path`. If the option is missing,
 * or its next token is itself a flag (starts with "-"), or there is no next
 * token, fall back to `def` instead of silently consuming a flag.
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
const dryRun: boolean = process.argv.includes("--dry-run");
const copilotHome: string = process.env.COPILOT_HOME || join(homedir(), ".copilot");
const mcpConfigPath: string = join(copilotHome, "mcp-config.json");
const repoHookFile: string = join(targetRepo, ".github", "hooks", "agentboard.json");
const agentsMdPath: string = join(targetRepo, "AGENTS.md");

console.log("agentboard — Copilot CLI uninstaller");
console.log(`  target repo : ${targetRepo}`);
console.log(`  COPILOT_HOME: ${copilotHome}`);
console.log(`  dry-run     : ${dryRun}`);
console.log("");

// Separate counters: `planned` covers everything that would be removed (used
// for the dry-run summary), `applied` only increments after a real mutation.
let planned = 0;
let applied = 0;

if (existsSync(mcpConfigPath)) {
  try {
    const cfg = JSON.parse(readFileSync(mcpConfigPath, "utf-8")) as MCPConfig;
    if (cfg?.mcpServers && (cfg.mcpServers as Record<string, unknown>).agentboard) {
      planned++;
      if (dryRun) {
        console.log(`[dry-run] would remove agentboard from ${mcpConfigPath}`);
      } else {
        delete (cfg.mcpServers as Record<string, unknown>).agentboard;
        atomicWrite(mcpConfigPath, JSON.stringify(cfg, null, 2) + "\n");
        console.log(`[-] removed agentboard from ${mcpConfigPath}`);
        applied++;
      }
    }
  } catch (e) {
    console.error(`[!] could not edit ${mcpConfigPath}: ${(e as Error)?.message ?? e}`);
  }
}

if (existsSync(repoHookFile)) {
  try {
    planned++;
    if (dryRun) {
      console.log(`[dry-run] would delete ${repoHookFile}`);
    } else {
      unlinkSync(repoHookFile);
      console.log(`[-] deleted ${repoHookFile}`);
      applied++;
    }
  } catch (e) {
    console.error(`[!] could not delete ${repoHookFile}: ${(e as Error)?.message ?? e}`);
  }
}

if (existsSync(agentsMdPath)) {
  try {
    const body = readFileSync(agentsMdPath, "utf-8");
    const seam = stripAgentboardStanza(body);
    if (seam !== null) {
      planned++;
      if (dryRun) {
        console.log(`[dry-run] would remove agentboard stanza from ${agentsMdPath}`);
      } else {
        atomicWrite(agentsMdPath, seam);
        console.log(`[-] removed agentboard stanza from ${agentsMdPath}`);
        applied++;
      }
    }
  } catch (e) {
    console.error(`[!] could not edit ${agentsMdPath}: ${(e as Error)?.message ?? e}`);
  }
}

if (dryRun) {
  console.log(planned > 0 ? `dry-run — ${planned} change(s) planned.` : "dry-run — nothing to remove.");
} else {
  console.log(applied > 0 ? `done — ${applied} change(s).` : "done — nothing to remove.");
}

/**
 * Returns the file contents with the agentboard stanza stripped, or null if
 * no stanza is present. Prefers exact sentinel match; falls back to the
 * legacy heading-based heuristic for installs that predate the sentinels.
 */
function stripAgentboardStanza(body: string): string | null {
  const beginIdx = body.indexOf(STANZA_BEGIN);
  const endIdx = body.indexOf(STANZA_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = body.slice(0, beginIdx);
    const tail = body.slice(endIdx + STANZA_END.length);
    return collapseSeam(before, tail);
  }
  // Legacy fallback: stanza added before sentinels existed. Match `## agentboard MCP`
  // and cut until the next top-level header or EOF.
  const legacyIdx = body.indexOf("## agentboard MCP");
  if (legacyIdx === -1) return null;
  const after = body.slice(legacyIdx);
  const next = after.slice(2).search(/\n## /);
  const cut = next === -1 ? body.length : legacyIdx + 2 + next;
  return collapseSeam(body.slice(0, legacyIdx), body.slice(cut));
}

function collapseSeam(before: string, tail: string): string {
  const left = before.endsWith("\n") ? before.replace(/\n+$/, "\n") : before;
  const right = tail.startsWith("\n") ? tail.replace(/^\n+/, "\n") : tail;
  return left + right;
}
