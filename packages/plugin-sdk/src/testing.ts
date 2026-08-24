import type {
  ProviderAdapter,
  ProviderRuntimeLimits,
  ProviderRuntimeRequest,
  ProviderSandboxPolicy,
} from "./provider.ts";
import { validateProviderManifest } from "./provider.ts";

export function createFakeProviderRequest(overrides: Partial<ProviderRuntimeRequest> = {}): ProviderRuntimeRequest {
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

export async function assertProviderContract(adapter: ProviderAdapter): Promise<void> {
  const validation = validateProviderManifest(adapter.manifest);
  if (!validation.ok) {
    throw new Error(`Invalid provider manifest: ${validation.errors.join("; ")}`);
  }

  const response = await adapter.run(createFakeProviderRequest());
  if (!["completed", "failed", "cancelled"].includes(response.status)) {
    throw new Error(`Invalid provider response status: ${String(response.status)}`);
  }
  if (response.status === "failed" && !response.error?.message) {
    throw new Error("Failed provider responses must include an error message");
  }
}
