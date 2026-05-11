---
name: open
description: Launch the agentboard UI from Codex. Boots (or reuses) the local server and opens the kanban board in the default browser.
---

1. Run `node --experimental-strip-types --no-warnings "${CODEX_PLUGIN_ROOT}/bin/ensure-server.ts"` to boot or reuse the agentboard core server. The script prints the local URL on success.
2. Read `~/.agentboard/config.json` (or `%USERPROFILE%\.agentboard\config.json` on Windows) to discover the port the server is bound to.
3. Open `http://127.0.0.1:<port>/` in the default browser:
   - Windows: `cmd /c start "" http://127.0.0.1:<port>/`
   - macOS:   `open http://127.0.0.1:<port>/`
   - Linux:   `xdg-open http://127.0.0.1:<port>/`
4. Surface the URL to the user; the UI handles project selection / setup on first launch.

Never print the Bearer token. The UI reads it from an inlined `<script>` on the served HTML.
