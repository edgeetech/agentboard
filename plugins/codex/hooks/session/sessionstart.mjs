#!/usr/bin/env node
/**
 * Codex SessionStart hook for agentboard.
 *
 * Codex's session_start stdin shape is wire-compatible with Claude Code's
 * (session_id, transcript_path, cwd, hook_event_name, source). The agentboard
 * implementation already lives next to the claude-code plugin — re-use it
 * verbatim by importing it. Fail loudly to stderr if the sibling plugin is
 * missing so the user sees an actionable hint instead of silent breakage.
 */
try {
  await import("../../../claude-code/hooks/session/sessionstart.mjs");
} catch (e) {
  if (e && e.code === "ERR_MODULE_NOT_FOUND") {
    process.stderr.write(
      "agentboard codex plugin: requires the claude-code plugin to be installed alongside it.\n",
    );
  }
  // Hook contract: still echo {} and exit 0.
  console.log("{}");
}
