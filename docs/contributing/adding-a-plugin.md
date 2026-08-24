# Adding a Provider Plugin

AgentBoard provider plugins execute AI work behind the shared plugin SDK contract.

This document describes the current contract seam. Provider runtime code still lives in the legacy core package during the refactor, so new provider packages should treat this as the author-facing target rather than a fully wired runtime loader.

## Package Location

Provider plugins live under:

```text
plugins/providers/<provider-id>
```

Use stable, lowercase provider IDs such as `claude`, `codex`, `github_copilot` or `gemini`. Provider IDs should be registry data, not hard-coded Engine branches.

## SDK Contract

Provider packages should export an adapter compatible with `@agentboard/plugin-sdk`.

The adapter has two parts:

- `manifest`: provider metadata, capabilities, runtime command and control enforcement declarations.
- `run(request)`: provider execution function that returns a normalized runtime response.

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

Use the SDK helpers to validate new providers:

```ts
import { assertProviderContract } from "@agentboard/plugin-sdk";
import { provider } from "../src/index.ts";

await assertProviderContract(provider);
```

Contract tests should run with a fake or dry-run provider implementation. Normal CI must not call real AI providers.

For deterministic plugin development tests, use the SDK fixture:

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

The fixture records received requests and returns stable session, event, model and usage data so provider registration can be tested without editing Engine code or calling an external AI service.

## Current Refactor Status

The SDK currently provides:

- provider manifest and runtime request/response types;
- manifest validation;
- an in-memory provider registry;
- fake request, deterministic provider and contract assertion test helpers.

The next provider phases will move Claude, Codex and Copilot runtime code out of the legacy core package into provider packages.
