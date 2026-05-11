#!/usr/bin/env node
/**
 * Codex SessionStart hook for agentboard. Delegates to the shared
 * claude-code session capture. Fails loudly to stderr if the sibling
 * plugin is missing so users see an actionable hint.
 */
await (async () => {
  try {
    await import("../../../claude-code/hooks/session/sessionstart.mjs");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      process.stderr.write(
        "agentboard codex plugin: requires the claude-code plugin to be installed alongside it.\n",
      );
    }
    console.log("{}");
  }
})();
