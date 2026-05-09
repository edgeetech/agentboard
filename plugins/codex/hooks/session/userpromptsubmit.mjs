#!/usr/bin/env node
try {
  await import("../../../claude-code/hooks/session/userpromptsubmit.mjs");
} catch (e) {
  if (e && e.code === "ERR_MODULE_NOT_FOUND") {
    process.stderr.write(
      "agentboard codex plugin: requires the claude-code plugin to be installed alongside it.\n",
    );
  }
}
