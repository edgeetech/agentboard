#!/usr/bin/env node
/**
 * Codex bin/ensure-server.ts
 *
 * Delegates to the shared TypeScript ensure-server in the claude-code plugin
 * (single source of truth for boot/reuse logic). Both plugins ship in the
 * same monorepo, so the relative path always resolves when installed from
 * this repo's marketplace.
 *
 * Sets AGENTBOARD_PLUGIN_ROOT (so /alive reports the codex plugin's version)
 * and AGENTBOARD_CORE_ROOT (so the spawn target is the shared
 * agent-board-core under claude-code/). Stdio is silenced when --silent is
 * passed so SessionStart stays quiet.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CODEX_PLUGIN_ROOT = resolve(HERE, "..");
const CLAUDE_PLUGIN_ROOT = resolve(CODEX_PLUGIN_ROOT, "..", "claude-code");
const TARGET = resolve(CLAUDE_PLUGIN_ROOT, "bin", "ensure-server.ts");
const CORE_ROOT = resolve(CLAUDE_PLUGIN_ROOT, "agent-board-core");

if (!existsSync(TARGET) || !existsSync(CORE_ROOT)) {
  process.stderr.write(
    "agentboard: codex plugin requires the agentboard claude-code plugin to be installed alongside it. " +
      `Expected to find ${TARGET}.\n`,
  );
  process.exit(2);
}

const silent: boolean = process.argv.includes("--silent");

const args: string[] = [
  "--experimental-sqlite",
  "--experimental-strip-types",
  "--no-warnings",
  TARGET,
  ...process.argv.slice(2),
];

const result = spawnSync(process.execPath, args, {
  stdio: silent ? ["ignore", "ignore", "ignore"] : "inherit",
  env: {
    ...process.env,
    AGENTBOARD_PLUGIN_ROOT: CODEX_PLUGIN_ROOT,
    AGENTBOARD_CORE_ROOT: CORE_ROOT,
  },
});

if (typeof result.status === "number") {
  process.exit(result.status);
}
process.exit(result.signal ? 1 : 0);
