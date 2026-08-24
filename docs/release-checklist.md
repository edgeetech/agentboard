# Release Checklist

Use this checklist before tagging or publishing AgentBoard.

## Version And Notes

- Confirm the intended version and release scope.
- Update `CHANGELOG.md`.
- Verify any plugin manifest version updates are intentional.
- Document migration or rollback notes for runtime, database, provider or API changes.

## Validation

Run the standard validation set:

```bash
npm run typecheck
npm run test
npm run test:architecture
npm run build
```

Also run any release-specific checks introduced by later refactor phases, including database migration verification, API contract checks and provider smoke tests.

## Runtime Safety

- Confirm database migrations are forward-tested from representative fixtures.
- Confirm rollback guidance exists for irreversible or manual changes.
- Confirm provider-specific changes are sandboxed and do not broaden environment or filesystem access unexpectedly.
- Confirm observability changes preserve run, task and activity audit trails.

## Packaging

- Confirm the Claude plugin still installs and starts from the published package layout.
- Confirm standalone server startup still works.
- Confirm generated UI assets are present when required by the package.

## After Release

- Push the tag.
- Publish release notes.
- Verify a fresh install path.
- Monitor issue reports and rollback triggers.
