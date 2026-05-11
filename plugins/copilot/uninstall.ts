#!/usr/bin/env node
/**
 * Copilot CLI uninstaller for agentboard. Reverses what install.ts did:
 *   1. Remove `agentboard` entry from ~/.copilot/mcp-config.json (kept if
 *      file gone or entry already absent).
 *   2. Delete <repo>/.github/hooks/agentboard.json (only the agentboard one).
 *   3. Strip the agentboard stanza from <repo>/AGENTS.md (idempotent).
 *
 * Usage: node --experimental-strip-types plugins/copilot/uninstall.ts [--repo /path/to/repo]
 */
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

interface MCPConfig {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

function atomicWrite(path: string, contents: string): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, "utf-8");
  renameSync(tmp, path);
}

function arg(name: string, def: string | boolean): string | boolean {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  if (typeof next === "string" && !next.startsWith("--")) return next;
  return true;
}

const targetRepo: string = resolve(String(arg("repo", process.cwd())));
const copilotHome: string = process.env.COPILOT_HOME || join(homedir(), ".copilot");
const mcpConfigPath: string = join(copilotHome, "mcp-config.json");
const repoHookFile: string = join(targetRepo, ".github", "hooks", "agentboard.json");
const agentsMdPath: string = join(targetRepo, "AGENTS.md");

let changed = 0;

if (existsSync(mcpConfigPath)) {
  try {
    const cfg = JSON.parse(readFileSync(mcpConfigPath, "utf-8")) as MCPConfig;
    if (cfg?.mcpServers && (cfg.mcpServers as Record<string, unknown>).agentboard) {
      delete (cfg.mcpServers as Record<string, unknown>).agentboard;
      atomicWrite(mcpConfigPath, JSON.stringify(cfg, null, 2) + "\n");
      console.log(`[-] removed agentboard from ${mcpConfigPath}`);
      changed++;
    }
  } catch (e) {
    console.error(`[!] could not edit ${mcpConfigPath}: ${(e as Error)?.message ?? e}`);
  }
}

if (existsSync(repoHookFile)) {
  try {
    unlinkSync(repoHookFile);
    console.log(`[-] deleted ${repoHookFile}`);
    changed++;
  } catch (e) {
    console.error(`[!] could not delete ${repoHookFile}: ${(e as Error)?.message ?? e}`);
  }
}

if (existsSync(agentsMdPath)) {
  try {
    const body = readFileSync(agentsMdPath, "utf-8");
    const idx = body.indexOf("## agentboard MCP");
    if (idx !== -1) {
      const after = body.slice(idx);
      const next = after.slice(2).search(/\n## /);
      const cut = next === -1 ? body.length : idx + 2 + next;
      const before = body.slice(0, idx);
      const tail = body.slice(cut);
      const seam = (before.endsWith("\n") ? before.replace(/\n+$/, "\n") : before)
        + (tail.startsWith("\n") ? tail.replace(/^\n+/, "\n") : tail);
      atomicWrite(agentsMdPath, seam);
      console.log(`[-] removed agentboard stanza from ${agentsMdPath}`);
      changed++;
    }
  } catch (e) {
    console.error(`[!] could not edit ${agentsMdPath}: ${(e as Error)?.message ?? e}`);
  }
}

console.log(changed > 0 ? `done — ${changed} change(s).` : "done — nothing to remove.");
