import type { ProviderManifest } from "../../../../packages/plugin-sdk/src/provider.ts";

export const copilotProviderManifest = {
  id: "github_copilot",
  displayName: "GitHub Copilot",
  version: "0.1.0",
  runtime: { command: "gh", args: ["copilot"] },
  capabilities: {
    streamingEvents: true,
    resume: "interactive",
    usage: "tokens",
    tools: [],
  },
  enforcement: {
    enforced: ["cwd", "mcpServerNames", "abortSignal", "rateLimitBackoff"],
    intentionallyIgnored: [
      "maxTurns",
      "allowedTools",
      "hooksEnabled",
      "approvalMode",
      "filesystemSandbox",
    ],
    notes: [
      "Legacy Copilot runner uses approveAll and does not enforce maxTurns or allowedTools.",
      "Approval mode is intentionally ignored until Copilot-specific approval mapping is implemented.",
    ],
  },
} as const satisfies ProviderManifest;

export interface CopilotRuntimeResult {
  status: "completed" | "failed" | "cancelled";
  sessionId?: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  };
  model?: string | null;
  totalCostUsd?: number | null;
  error?: string;
  errorKind?: "timeout" | "error";
}

export interface CopilotRuntimeSessionRef {
  provider: typeof copilotProviderManifest.id;
  sessionId: string;
}

export interface CopilotProviderRuntimeResult extends CopilotRuntimeResult {
  sessionRef?: CopilotRuntimeSessionRef | null;
}

export interface CopilotRunnerInstance {
  run(): Promise<CopilotRuntimeResult>;
}

export interface CopilotRunnerConstructor<TContext> {
  new (ctx: TContext): CopilotRunnerInstance;
}

export interface CopilotProviderAdapter<TContext> {
  readonly provider: typeof copilotProviderManifest.id;
  readonly enforcement: typeof copilotProviderManifest.enforcement;
  readonly resume: {
    readonly interactive: true;
    command(sessionId: string, repoPath?: string | null): string | null;
  };
  run(ctx: TContext): Promise<CopilotProviderRuntimeResult>;
}

export function createCopilotProviderAdapter<TContext>(args: {
  Runner: CopilotRunnerConstructor<TContext>;
  buildResumeCommand: (
    provider: typeof copilotProviderManifest.id,
    sessionId: string,
    repoPath?: string | null,
  ) => string | null;
}): CopilotProviderAdapter<TContext> {
  return {
    provider: copilotProviderManifest.id,
    enforcement: copilotProviderManifest.enforcement,
    resume: {
      interactive: true,
      command: (sessionId, repoPath) =>
        args.buildResumeCommand(
          copilotProviderManifest.id,
          sessionId,
          repoPath,
        ),
    },
    async run(ctx) {
      const runner = new args.Runner(ctx);
      const result = await runner.run();
      return {
        ...result,
        sessionRef:
          typeof result.sessionId === "string" && result.sessionId.length > 0
            ? {
                provider: copilotProviderManifest.id,
                sessionId: result.sessionId,
              }
            : null,
      };
    },
  };
}
