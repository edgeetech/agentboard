import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];

function rel(path) {
  return relative(root, path).replace(/\\/g, "/");
}

function mustExist(path, reason) {
  if (!existsSync(path)) failures.push(`${rel(path)} missing (${reason})`);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function mustContain(path, needle, reason) {
  if (!read(path).includes(needle)) {
    failures.push(`${rel(path)} missing '${needle}' (${reason})`);
  }
}

function readJson(path) {
  return JSON.parse(read(path));
}

function hookCommands(path) {
  const hooks = readJson(path);
  const commands = [];
  for (const entries of Object.values(hooks.hooks ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        if (typeof hook.command === "string") commands.push(hook.command);
      }
    }
  }
  return commands;
}

const coreRoot = join(root, "plugins", "claude-code", "agent-board-core");
const claudeEnsure = join(
  root,
  "plugins",
  "claude-code",
  "bin",
  "ensure-server.ts",
);
const codexEnsure = join(root, "plugins", "codex", "bin", "ensure-server.ts");
const claudeMcp = join(root, "plugins", "claude-code", "mcp", "agentboard.mjs");
const codexMcp = join(root, "plugins", "codex", "mcp", "agentboard.ts");
const copilotInstall = join(root, "plugins", "copilot", "install.ts");

for (const [path, reason] of [
  [claudeEnsure, "Claude Code host launcher"],
  [codexEnsure, "Codex host launcher"],
  [join(coreRoot, "server.ts"), "shared server entry"],
  [join(coreRoot, "package.json"), "first-run dependency install target"],
  [
    join(coreRoot, "src", "generated", "sqlite-persistence.mjs"),
    "packaged SQLite persistence adapter",
  ],
  [
    join(coreRoot, "src", "generated", "plugin-sdk-registry.mjs"),
    "packaged provider runtime registry",
  ],
  [
    join(coreRoot, "src", "generated", "codex-provider.mjs"),
    "packaged Codex provider runtime",
  ],
  [
    join(coreRoot, "src", "generated", "claude-runner.mjs"),
    "packaged Claude provider runtime",
  ],
  [
    join(coreRoot, "src", "generated", "copilot-runner.mjs"),
    "packaged Copilot provider runtime",
  ],
  [join(coreRoot, "ui", "dist", "index.html"), "served UI artifact"],
  [claudeMcp, "shared MCP entry"],
  [codexMcp, "Codex MCP shim"],
  [copilotInstall, "Copilot installer"],
]) {
  mustExist(path, reason);
}

mustContain(
  claudeEnsure,
  "AGENTBOARD_PLUGIN_ROOT",
  "sibling hosts report their own version",
);
mustContain(
  claudeEnsure,
  "AGENTBOARD_CORE_ROOT",
  "sibling hosts can point at shared core",
);
mustContain(
  claudeEnsure,
  "probeAlive",
  "launcher can reuse an existing server",
);
mustContain(
  claudeEnsure,
  "spawnServer",
  "launcher can start the shared server",
);
mustContain(claudeEnsure, "/alive", "launcher checks runtime identity");
mustContain(
  join(coreRoot, "src", "codex-runner.ts"),
  "./generated/codex-provider.mjs",
  "legacy Codex runner shim resolves inside the shipped plugin",
);
mustContain(
  join(coreRoot, "src", "codex-config.ts"),
  "./generated/codex-provider.mjs",
  "legacy Codex config shim resolves inside the shipped plugin",
);
for (const bundle of [
  "./generated/claude-runner.mjs",
  "./generated/codex-provider.mjs",
  "./generated/copilot-runner.mjs",
]) {
  mustContain(
    join(coreRoot, "src", "provider-registry.ts"),
    bundle,
    "provider composition resolves inside the shipped plugin",
  );
}
mustContain(
  join(coreRoot, "src", "agent-runner.ts"),
  "./generated/claude-runner.mjs",
  "legacy Claude shim resolves inside the shipped plugin",
);
mustContain(
  join(coreRoot, "src", "copilot-runner.ts"),
  "./generated/copilot-runner.mjs",
  "legacy Copilot shim resolves inside the shipped plugin",
);

mustContain(
  codexEnsure,
  "claude-code",
  "Codex delegates to the shared Claude Code runtime",
);
mustContain(
  codexEnsure,
  "AGENTBOARD_PLUGIN_ROOT",
  "Codex reports its plugin root",
);
mustContain(
  codexEnsure,
  "AGENTBOARD_CORE_ROOT",
  "Codex points at shared core root",
);
mustContain(
  codexEnsure,
  "--experimental-strip-types",
  "Codex can execute TypeScript launcher",
);

mustContain(
  codexMcp,
  "../../claude-code/mcp/agentboard.mjs",
  "Codex reuses shared MCP entry",
);
mustContain(
  copilotInstall,
  "plugins/claude-code/bin/ensure-server.ts",
  "Copilot documents shared server bootstrap",
);

const claudeHookCommands = hookCommands(
  join(root, "plugins", "claude-code", "hooks", "hooks.json"),
);
if (
  !claudeHookCommands.some((command) =>
    command.includes("bin/ensure-server.ts"),
  )
) {
  failures.push(
    "plugins/claude-code/hooks/hooks.json does not start ensure-server.ts",
  );
}

const codexHookCommands = hookCommands(
  join(root, "plugins", "codex", "hooks", "hooks.json"),
);
if (
  !codexHookCommands.some((command) => command.includes("bin/ensure-server.ts"))
) {
  failures.push(
    "plugins/codex/hooks/hooks.json does not start ensure-server.ts",
  );
}

if (failures.length > 0) {
  console.error("Host startup smoke check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Host startup smoke check passed.");
