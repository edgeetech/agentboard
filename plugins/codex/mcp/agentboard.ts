#!/usr/bin/env node
/**
 * Codex MCP shim for agentboard. Reuses the platform-neutral MCP server
 * bundled with the Claude Code plugin. Both plugins ship in the same
 * monorepo, so the relative path always resolves when the user installs
 * from this repo's marketplace. Fails loudly to stderr if missing.
 */
await (async () => {
  try {
    await import("../../claude-code/mcp/agentboard.mjs");
  } catch (e) {
    process.stderr.write(
      "agentboard codex plugin: requires the claude-code plugin to be installed alongside it. " +
        `(${(e as Error)?.message ?? String(e)})\n`,
    );
    process.exit(2);
  }
})();
