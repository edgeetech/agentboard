export const PROVIDER_RUNTIME_CONTROLS = [
  "cwd",
  "maxTurns",
  "allowedTools",
  "mcpServerNames",
  "hooksEnabled",
  "abortSignal",
  "rateLimitBackoff",
  "approvalMode",
  "filesystemSandbox",
] as const;

export type ProviderRuntimeControl = (typeof PROVIDER_RUNTIME_CONTROLS)[number];

export interface ProviderRuntimeLimits {
  readonly cwd: string;
  readonly maxTurns: number;
  readonly allowedTools: readonly string[];
  readonly mcpServerNames: readonly string[];
  readonly hooksEnabled: boolean;
  readonly abortSignal: boolean;
  readonly rateLimitBackoff: boolean;
}

export interface ProviderSandboxPolicy {
  readonly workspaceCwd: string;
  readonly restrictToWorkspace: boolean;
  readonly allowUserMcpServers: boolean;
  readonly approvalMode: "provider-default" | "accept-edits" | "approve-all" | "disabled";
  readonly notes: readonly string[];
}

export interface ProviderRuntimeEnforcement {
  readonly enforced: readonly ProviderRuntimeControl[];
  readonly intentionallyIgnored: readonly ProviderRuntimeControl[];
  readonly notes: readonly string[];
}

export interface ProviderRuntimeCapabilities {
  readonly streamingEvents: boolean;
  readonly resume: "none" | "interactive" | "programmatic";
  readonly usage: "none" | "tokens" | "cost";
  readonly tools: readonly string[];
}

export interface ProviderManifest {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly runtime: {
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: readonly string[];
  };
  readonly capabilities: ProviderRuntimeCapabilities;
  readonly enforcement: ProviderRuntimeEnforcement;
}

export interface ProviderRuntimeRequest {
  readonly runId: string;
  readonly role: string;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly limits: ProviderRuntimeLimits;
  readonly sandbox: ProviderSandboxPolicy;
}

export interface ProviderRuntimeEvent {
  readonly name: string;
  readonly detail: Record<string, unknown>;
}

export interface ProviderRuntimeUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly cacheReadTokens?: number;
  readonly costUsd?: number;
}

export interface ProviderRuntimeResponse {
  readonly status: "completed" | "failed" | "cancelled";
  readonly sessionId?: string;
  readonly model?: string;
  readonly usage?: ProviderRuntimeUsage;
  readonly events?: readonly ProviderRuntimeEvent[];
  readonly error?: {
    readonly kind: "timeout" | "provider" | "cancelled" | "unknown";
    readonly message: string;
  };
}

export interface ProviderAdapter {
  readonly manifest: ProviderManifest;
  run(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse>;
}

export interface ProviderManifestValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateProviderManifest(manifest: ProviderManifest): ProviderManifestValidation {
  const errors: string[] = [];
  if (manifest.id.trim().length === 0) errors.push("manifest.id is required");
  if (manifest.displayName.trim().length === 0) errors.push("manifest.displayName is required");
  if (manifest.version.trim().length === 0) errors.push("manifest.version is required");
  if (manifest.runtime.command.trim().length === 0) errors.push("manifest.runtime.command is required");

  const knownControls = new Set<string>(PROVIDER_RUNTIME_CONTROLS);
  const enforced = new Set<string>();
  const ignored = new Set<string>();

  for (const control of manifest.enforcement.enforced) {
    if (!knownControls.has(control)) errors.push(`unknown enforced control: ${control}`);
    enforced.add(control);
  }

  for (const control of manifest.enforcement.intentionallyIgnored) {
    if (!knownControls.has(control)) errors.push(`unknown ignored control: ${control}`);
    ignored.add(control);
  }

  for (const control of enforced) {
    if (ignored.has(control)) errors.push(`control cannot be both enforced and ignored: ${control}`);
  }

  for (const control of PROVIDER_RUNTIME_CONTROLS) {
    if (!enforced.has(control) && !ignored.has(control)) {
      errors.push(`runtime control must be declared enforced or ignored: ${control}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
