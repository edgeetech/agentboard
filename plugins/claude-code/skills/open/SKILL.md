---
name: open
description: Launch the agentboard UI. Starts (or reuses) the local AgentBoard runtime, prints the URL, and opens the board in the default browser.
---

1. Run `node --experimental-strip-types --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/ensure-server.ts" open`. It installs the runtime on first use (into `~/.agentboard/runtime`), starts or reuses the server, prints the URL and opens it in the default browser.
2. Tell the user the URL so they can bookmark it. If no active project exists, the UI shows the Setup Wizard.
3. If it fails, run `node --experimental-strip-types --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/ensure-server.ts" status` and report the `last start failed` reason it prints.

Do not print the Bearer token — the UI reads it from an inlined `<script>` on `index.html`.
