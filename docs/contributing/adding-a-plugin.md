# Adding a Provider Plugin

AgentBoard provider plugins execute AI work behind the shared plugin SDK contract.

This document describes the current contract seam and the target SDK direction. Provider packages currently own provider manifests and provider-specific adapter factories, but they are not yet standalone runtime loaders. Claude and Codex execution still remains in the legacy core; the Copilot runner has moved into its provider package, while the legacy core keeps a compatibility re-export.

## Package Location

Provider plugins live under:

```text
plugins/providers/<provider-id>
```

Use stable, lowercase provider IDs such as `claude`, `codex`, `github_copilot` or `gemini`. Provider IDs should be registry data, not hard-coded Engine branches.

## SDK Contract

Provider packages should export a validated manifest and a provider-specific adapter factory. The current packages expose factories named for the provider, such as `createClaudeProviderAdapter`, `createCodexProviderAdapter` and `createCopilotProviderAdapter`.

The factory wraps an injected runner and returns an adapter with provider-specific runtime methods. For example:

```ts
import {
  createCopilotProviderAdapter,
  type CopilotRuntimeResult,
} from "../src/index.ts";

class TestRunner {
  constructor(readonly context: unknown) {}

  run(): Promise<CopilotRuntimeResult> {
    return Promise.resolve({ status: "completed" });
  }
}

const adapter = createCopilotProviderAdapter({
  Runner: TestRunner,
  buildResumeCommand: (_provider, sessionId, repoPath) =>
    `${repoPath ?? "<none>"}:${sessionId}`,
});
```

The provider package exports a manifest value, such as `copilotProviderManifest`. The manifest contains:

- provider metadata, capabilities and runtime command information;
- `enforcement`: the runtime controls that the current adapter enforces or intentionally ignores.

The long-term SDK contract is `ProviderAdapter` from `@agentboard/plugin-sdk`, which combines a manifest with `run(request)` and can be registered in the SDK provider registry. Current provider-specific factories do not export a top-level `provider` value with that generic shape. Keep the factory and manifest exports aligned with the package's existing pattern until the runtime composition migration is complete.

The manifest must account for every runtime control as either enforced or intentionally ignored:

- `cwd`
- `maxTurns`
- `allowedTools`
- `mcpServerNames`
- `hooksEnabled`
- `abortSignal`
- `rateLimitBackoff`
- `approvalMode`
- `filesystemSandbox`

Do not omit unsupported controls. If a provider cannot enforce a control yet, declare it in `intentionallyIgnored` and explain the risk in `notes`.

## Sandbox And Resource Limits

Provider plugins must keep sandbox behavior explicit:

- validate and use the requested workspace cwd;
- do not receive unrelated provider credentials by default;
- document child-process behavior;
- document cancellation behavior;
- document which tools, MCP servers and approval modes are enforced;
- avoid silently widening filesystem or shell access.

If a runtime cannot satisfy required sandbox controls, the host composition layer should either mark that provider unavailable for the requested run or expose the risk clearly in provider metadata.

## Contract Tests

For the current provider-specific factories, test the manifest and factory behavior with an injected fake runner. The existing provider tests under `plugins/providers/test` and `plugins/providers/copilot/test` demonstrate this pattern.

For a provider that implements the target generic SDK contract, use the SDK helpers and fixture:

```ts
import {
  assertProviderContract,
  createDeterministicProviderAdapter,
} from "@agentboard/plugin-sdk";

const provider = createDeterministicProviderAdapter({
  manifest: { id: "gemini" },
});
await assertProviderContract(provider);
```

The local `provider` variable above is a test adapter; it does not imply that provider packages export a `provider` value. Contract tests should run with a fake or dry-run provider implementation. Normal CI must not call real AI providers.

The fixture records received requests and returns stable session, event, model and usage data so provider registration can be tested without editing Engine code or calling an external AI service.

## Current Refactor Status

The SDK currently provides:

- provider manifest and runtime request/response types;
- manifest validation;
- an in-memory provider registry;
- fake request, deterministic provider and contract assertion test helpers.

The next provider phases will complete runtime ownership moves for Claude and Codex, finish host/runtime composition around the package-owned Copilot runner, and adapt provider packages to the generic `ProviderAdapter` registry contract. Until then, preserve the legacy core compatibility paths and do not assume that installing a provider package alone makes its runtime executable.
