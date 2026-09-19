import type {
  ProviderAdapter,
  ProviderManifest,
  ProviderRuntimeLimits,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderSandboxPolicy,
} from "./provider.ts";
import { validateProviderManifest } from "./provider.ts";

export interface DeterministicProviderAdapter extends ProviderAdapter {
  readonly requests: readonly ProviderRuntimeRequest[];
}

export interface DeterministicProviderOptions {
  readonly manifest?: Partial<ProviderManifest>;
  readonly response?: Partial<ProviderRuntimeResponse>;
}

export function createFakeProviderRequest(
  overrides: Partial<ProviderRuntimeRequest> = {},
): ProviderRuntimeRequest {
  const limits: ProviderRuntimeLimits = {
    cwd: "/workspace",
    maxTurns: 3,
    allowedTools: ["Read"],
    mcpServerNames: [],
    hooksEnabled: false,
    abortSignal: true,
    rateLimitBackoff: true,
  };

  const sandbox: ProviderSandboxPolicy = {
    workspaceCwd: "/workspace",
    restrictToWorkspace: true,
    allowUserMcpServers: false,
    approvalMode: "provider-default",
    notes: [],
  };

  return {
    runId: "run-test",
    role: "worker",
    prompt: "Do the test task.",
    systemPrompt: "You are a test provider.",
    limits,
    sandbox,
    ...overrides,
  };
}

export async function assertProviderContract(
  adapter: ProviderAdapter,
): Promise<void> {
  const validation = validateProviderManifest(adapter.manifest);
  if (!validation.ok) {
    throw new Error(
      `Invalid provider manifest: ${validation.errors.join("; ")}`,
    );
  }

  const response = await adapter.run(createFakeProviderRequest());
  if (!["completed", "failed", "cancelled"].includes(response.status)) {
    throw new Error(
      `Invalid provider response status: ${String(response.status)}`,
    );
  }
  if (response.status === "failed" && !response.error?.message) {
    throw new Error("Failed provider responses must include an error message");
  }
  if (
    adapter.manifest.capabilities.streamingEvents &&
    (response.events?.length ?? 0) === 0
  ) {
    throw new Error(
      "Providers declaring streamingEvents must return at least one normalized event in contract tests",
    );
  }
  if (adapter.manifest.capabilities.resume !== "none" && !response.sessionId) {
    throw new Error(
      "Providers declaring resume support must return a sessionId in contract tests",
    );
  }
  if (
    adapter.manifest.capabilities.usage !== "none" &&
    response.usage === undefined
  ) {
    throw new Error(
      "Providers declaring usage support must return normalized usage in contract tests",
    );
  }
  for (const event of response.events ?? []) {
    if (event.name.trim().length === 0)
      throw new Error("Provider events must include a non-empty name");
  }
}

export function createDeterministicProviderAdapter(
  options: DeterministicProviderOptions = {},
): DeterministicProviderAdapter {
  const requests: ProviderRuntimeRequest[] = [];
  const manifest = mergeManifest(options.manifest);

  return {
    manifest,
    get requests() {
      return [...requests];
    },
    async run(request) {
      requests.push(request);
      return {
        status: "completed",
        sessionId: `${request.runId}:session`,
        model: `${manifest.id}:model`,
        usage: {
          inputTokens: request.prompt.length,
          outputTokens: request.systemPrompt.length,
          costUsd: 0,
        },
        events: [
          {
            name: "provider.started",
            detail: {
              providerId: manifest.id,
              runId: request.runId,
              role: request.role,
            },
          },
          {
            name: "provider.completed",
            detail: { providerId: manifest.id, runId: request.runId },
          },
        ],
        ...options.response,
      };
    },
  };
}

function mergeManifest(
  overrides: Partial<ProviderManifest> = {},
): ProviderManifest {
  const base: ProviderManifest = {
    id: "deterministic",
    displayName: "Deterministic Provider",
    version: "0.1.0",
    runtime: { command: "deterministic-agent" },
    capabilities: {
      streamingEvents: true,
      resume: "programmatic",
      usage: "tokens",
      tools: ["Read"],
    },
    enforcement: {
      enforced: [
        "cwd",
        "maxTurns",
        "allowedTools",
        "mcpServerNames",
        "hooksEnabled",
        "abortSignal",
        "rateLimitBackoff",
        "approvalMode",
        "filesystemSandbox",
      ],
      intentionallyIgnored: [],
      notes: ["deterministic provider enforces every requested control"],
    },
  };

  return {
    ...base,
    ...overrides,
    runtime: { ...base.runtime, ...overrides.runtime },
    capabilities: { ...base.capabilities, ...overrides.capabilities },
    enforcement: { ...base.enforcement, ...overrides.enforcement },
  };
}
