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

## Example: Implementing a New Provider (Gemini)

This example shows how to add a new provider without modifying Engine business logic.

### Step 1: Create Provider Package

```bash
mkdir -p plugins/providers/gemini/src
mkdir -p plugins/providers/gemini/test
```

Create `plugins/providers/gemini/package.json`:

```json
{
  "name": "@agentboard/provider-gemini",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "dependencies": {
    "@agentboard/plugin-sdk": "workspace:*",
    "@google/generative-ai": "^0.3.0"
  }
}
```

### Step 2: Implement Provider Adapter

Create `plugins/providers/gemini/src/index.ts`:

```ts
import {
  type ProviderManifest,
  type AgentExecutionRequest,
  type AgentExecutionResult,
  isTimeoutError,
} from "@agentboard/plugin-sdk";

export const geminiProviderManifest: ProviderManifest = {
  id: "gemini",
  name: "Google Gemini",
  description: "Google's Gemini AI model",
  capabilities: ["code_generation", "analysis", "review"],
  environment: {
    required: ["GEMINI_API_KEY"],
    optional: ["GEMINI_MODEL", "GEMINI_LOG_LEVEL"],
    denied: ["AWS_*", "AZURE_*", "ANTHROPIC_*"], // No cross-cloud creds
  },
  enforcement: {
    enforced: ["cwd", "maxTurns", "filesystemSandbox"],
    intentionallyIgnored: ["hooksEnabled"],
    notes: "Gemini does not support hooks in v0.3; upgrade to v0.4 for hook support",
  },
};

export async function createGeminiRuntime(config: {
  apiKey: string;
  model?: string;
}) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const client = new GoogleGenerativeAI(config.apiKey);
  const model = config.model ?? "gemini-2.0-pro";

  return {
    async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
      try {
        const generationConfig = {
          temperature: 0.7,
          maxOutputTokens: request.maxTokens ?? 4096,
        };

        const result = await client
          .getGenerativeModel({ model })
          .generateContent({
            contents: [{ role: "user", parts: [{ text: request.prompt }] }],
            generationConfig,
          });

        const text = result.response.text();
        return {
          status: "completed",
          output: text,
          usage: {
            inputTokens: result.response.usageMetadata?.promptTokens ?? 0,
            outputTokens: result.response.usageMetadata?.candidatesTokens ?? 0,
          },
          session: { modelUsed: model, providerId: "gemini" },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        
        // Detect timeout and use shared pattern from plugin-sdk
        if (isTimeoutError(message)) {
          return {
            status: "failed",
            error: `Gemini execution timed out: ${message}`,
            errorKind: "timeout",
          };
        }

        // Detect rate limit
        if (message.includes("429") || message.includes("quota")) {
          return {
            status: "failed",
            error: `Gemini rate limited: ${message}`,
            errorKind: "rate_limit",
            retryAfterMs: 60000, // Retry after 60s
          };
        }

        return {
          status: "failed",
          error: message,
          errorKind: "provider",
        };
      }
    },
  };
}
```

### Step 3: Add Contract Tests

Create `plugins/providers/gemini/test/gemini.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  assertProviderContract,
  createDeterministicProviderAdapter,
} from "@agentboard/plugin-sdk";

describe("Gemini Provider", () => {
  it("implements provider contract", async () => {
    const provider = createDeterministicProviderAdapter({
      manifest: { id: "gemini" },
    });
    await assertProviderContract(provider);
  });

  it("declares required environment", () => {
    const required = geminiProviderManifest.environment.required;
    expect(required).toContain("GEMINI_API_KEY");
  });

  it("declares denied environment variables", () => {
    const denied = geminiProviderManifest.environment.denied;
    expect(denied).toContain("AWS_*");
    expect(denied).toContain("ANTHROPIC_*");
  });
});
```

### Step 4: Register Provider

In the host/composition layer (automatically discovered via provider registry):

```ts
import { registerProvider } from "@agentboard/plugin-sdk";
import { geminiProviderManifest, createGeminiRuntime } from "@agentboard/provider-gemini";

await registerProvider({
  manifest: geminiProviderManifest,
  createRuntime: (config) => createGeminiRuntime(config),
});
```

**That's it!** The Engine automatically handles:
- Provider selection per role/task
- Configuration precedence
- Provider switching
- Error normalization
- Token tracking

**No Engine changes required.**

## Environment Variable Policy

Provider plugins must strictly control environment access.

### Declaration

Each provider must declare in its manifest:

```ts
environment: {
  required: ["API_KEY"],           // Must exist, error if missing
  optional: ["LOG_LEVEL"],         // Used if present
  denied: ["AWS_*", "AZURE_*"],    // Explicitly blocked
}
```

### Enforcement

Host composition must:

1. Reject providers that cannot meet `denied` rules
2. Validate `required` vars exist before launching
3. Pass only declared env to provider process
4. Log env access violations

```ts
// Example host enforcement
function validatePluginEnvironment(plugin: Plugin, env: Record<string, string>) {
  const { required = [], denied = [] } = plugin.manifest.environment;

  for (const pattern of denied) {
    for (const [key] of Object.entries(env)) {
      if (minimatch(key, pattern)) {
        throw new Error(`Denied env var for plugin: ${key}`);
      }
    }
  }

  for (const key of required) {
    if (!(key in env)) {
      throw new Error(`Required env var not set: ${key}`);
    }
  }
}
```

### Testing

Add regression tests for env isolation:

```ts
it("provider does not receive unrelated env vars", async () => {
  process.env.UNRELATED_SECRET = "should-not-leak";
  const runtime = await createRuntime({
    environment: { GEMINI_API_KEY: "test-key" },
  });
  // Verify UNRELATED_SECRET was not passed to runtime
});
```
