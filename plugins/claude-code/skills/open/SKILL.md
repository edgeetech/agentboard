---
name: open
description: Launch the agentboard UI. Starts (or reuses) the local server, prints the URL, and opens the board in the default browser.
---

1. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ensure-server.mjs"` — this boots or reuses the core server and prints the URL.
2. Read `~/.agentboard/config.json` to get `port` (Windows: `%USERPROFILE%\.agentboard\config.json`).
3. Open the URL `http://127.0.0.1:<port>/` in the user's default browser:
   - Windows: `cmd /c start "" http://127.0.0.1:<port>/`
   - macOS:   `open http://127.0.0.1:<port>/`
   - Linux:   `xdg-open http://127.0.0.1:<port>/`
4. Tell the user the URL so they can bookmark it. If no active project exists, the UI will show the Setup Wizard.

Do not print the Bearer token — the UI reads it from an inlined `<script>` on `index.html`.
