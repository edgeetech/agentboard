# Contributing

AgentBoard is being refactored toward a layered architecture. Keep changes small, reviewable and aligned with the repository boundaries.

## Development Setup

Use Node.js 22 or newer.

```bash
npm install
npm run typecheck
npm run test
npm run test:architecture
```

The current legacy core still lives under `plugins/claude-code/agent-board-core`. Root scripts delegate to that package while new packages are introduced.

## Commit Policy

Each meaningful refactoring phase or implementation chunk must be a separate commit. Do not mix runtime behavior changes, package-boundary moves, generated output, and documentation updates unless they are inseparable.

Recommended commit shape:

- baseline or characterization tests first;
- package or boundary scaffold separately;
- one extracted policy/service per commit;
- one runtime adapter per commit;
- verification/tooling changes separately.

## Architecture Rules

- Engine code must stay provider-agnostic.
- UI code must not import persistence or provider runtimes.
- Provider-specific SDKs and process details belong in provider/host integration packages.
- SQLite, filesystem, process, network and HTTP side effects belong outside pure Engine policy code.
- AI assets under `ai/` must remain Markdown-only.

Run `npm run test:architecture` before opening or updating a PR.

## Validation Expectations

For normal code changes, run:

```bash
npm run typecheck
npm run test
npm run test:architecture
npm run build
```

If a command cannot be run or is known to fail at baseline, state that explicitly in the PR.

## Changelog

Update `CHANGELOG.md` for user-visible behavior, migration notes, provider/runtime changes, and release-process changes. Internal-only refactor commits can be grouped under the next unreleased entry.
