# Changelog

All notable changes to AgentBoard should be recorded here.

This project follows a practical changelog format:

- `Added` for new features.
- `Changed` for behavior or architecture changes.
- `Deprecated` for features scheduled for removal.
- `Removed` for removed features.
- `Fixed` for bug fixes.
- `Security` for vulnerability or hardening changes.

## Unreleased

### Added

- Standalone runtime: `core/` is the `agentboard` package with its own CLI (`start`, `stop`, `restart`, `status`, `open`, `update`, `path`). The server runs detached and keeps its last port.
- Per-provider sign-in mode (`subscription`, `api_key`, `auto`) in Project → Sign-in & billing. Each run records how it signed in; subscription costs show as API-equivalent estimates (`≈`).
- Usage-limit handling for Claude, Codex and Copilot: `RATE_LIMITED` comment with the reset time and a retry that does not use an attempt.
- Doctor checks for provider sign-in and for an API key that would override a subscription login.
- Sessions page and session detail redesign with a background session index.

### Changed

- Host plugins (Claude Code, Codex) no longer contain the runtime. They find it (`AGENTBOARD_RUNTIME`, the surrounding checkout, or `~/.agentboard/runtime`, cloned on first use) and forward to the CLI. Plugin updates no longer restart the server; `/agentboard:update` updates the runtime with git.
- The Codex plugin ships its own copies of the MCP proxy and session hooks and works without the Claude Code plugin.
- `/alive` reports the runtime version.

- Started the architecture refactor toward separate UI, Engine, Contracts, Infrastructure, Server, Plugin SDK and provider package boundaries.
- Added repository governance expectations for separate phase commits, validation, ownership and release checks.

### Fixed

- Project settings Save button was covered by the tracker card's fixed footer.
- Built-in skills and concerns loaded from `ai/` again after the runtime move.

### Security

- `/mcp` accepts only a running run's `run_token`; spawned agents never receive the server token. `claim_run` and `list_queue` are no longer MCP tools.
- Spawned agents get a whitelisted environment; subscription mode also strips the provider's API-key variables.
- Tool policy checks every part of compound shell commands and always blocks inline code evaluation and data-dir access.
