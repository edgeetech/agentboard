#!/usr/bin/env node
await (async () => {
  try {
    await import("../../../claude-code/hooks/session/userpromptsubmit.mjs");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      process.stderr.write(
        "agentboard codex plugin: requires the claude-code plugin to be installed alongside it.\n",
      );
    }
  }
})();
