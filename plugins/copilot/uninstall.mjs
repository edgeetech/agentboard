#!/usr/bin/env node
/**
 * Copilot CLI uninstaller for agentboard. Reverses what install.mjs did:
 *   1. Remove `agentboard` entry from ~/.copilot/mcp-config.json (kept if
 *      file gone or entry already absent).
 *   2. Delete <repo>/.github/hooks/agentboard.json (only the agentboard one).
 *   3. Strip the agentboard stanza from <repo>/AGENTS.md (idempotent).
 *
 * Usage: node plugins/copilot/uninstall.mjs [--repo /path/to/repo]
 */
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

function atomicWrite(path, contents) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents, "utf-8");
  renameSync(tmp, path);
}

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  if (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return true;
}

const targetRepo = resolve(arg("repo", process.cwd()));
const copilotHome = process.env.COPILOT_HOME || join(homedir(), ".copilot");
const mcpConfigPath = join(copilotHome, "mcp-config.json");
const repoHookFile = join(targetRepo, ".github", "hooks", "agentboard.json");
const agentsMdPath = join(targetRepo, "AGENTS.md");

let changed = 0;

if (existsSync(mcpConfigPath)) {
  try {
    const cfg = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
    if (cfg?.mcpServers?.agentboard) {
      delete cfg.mcpServers.agentboard;
      atomicWrite(mcpConfigPath, JSON.stringify(cfg, null, 2) + "\n");
      console.log(`[-] removed agentboard from ${mcpConfigPath}`);
      changed++;
    }
  } catch (e) {
    console.error(`[!] could not edit ${mcpConfigPath}: ${e?.message ?? e}`);
  }
}

if (existsSync(repoHookFile)) {
  try {
    unlinkSync(repoHookFile);
    console.log(`[-] deleted ${repoHookFile}`);
    changed++;
  } catch (e) {
    console.error(`[!] could not delete ${repoHookFile}: ${e?.message ?? e}`);
  }
}

if (existsSync(agentsMdPath)) {
  try {
    const body = readFileSync(agentsMdPath, "utf-8");
    const idx = body.indexOf("## agentboard MCP");
    if (idx !== -1) {
      // Strip from the heading to the next "## " or EOF.
      const after = body.slice(idx);
      const next = after.slice(2).search(/\n## /);
      const cut = next === -1 ? body.length : idx + 2 + next;
      const before = body.slice(0, idx);
      const tail = body.slice(cut);
      // Only collapse runs of newlines at the splice seam, not the whole doc.
      const seam = (before.endsWith("\n") ? before.replace(/\n+$/, "\n") : before)
        + (tail.startsWith("\n") ? tail.replace(/^\n+/, "\n") : tail);
      atomicWrite(agentsMdPath, seam);
      console.log(`[-] removed agentboard stanza from ${agentsMdPath}`);
      changed++;
    }
  } catch (e) {
    console.error(`[!] could not edit ${agentsMdPath}: ${e?.message ?? e}`);
  }
}

console.log(changed > 0 ? `done — ${changed} change(s).` : "done — nothing to remove.");
