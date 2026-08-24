import type { ProviderManifest } from "../../../../packages/plugin-sdk/src/provider.ts";

export const codexProviderManifest = {
  id: "codex",
  displayName: "Codex",
  version: "0.1.0",
  runtime: { command: "codex" },
  capabilities: {
    streamingEvents: true,
    resume: "interactive",
    usage: "cost",
    tools: ["Read", "Edit", "Bash", "Grep", "Glob"],
  },
  enforcement: {
    enforced: [
      "cwd",
      "mcpServerNames",
      "abortSignal",
      "rateLimitBackoff",
      "filesystemSandbox",
    ],
    intentionallyIgnored: [
      "maxTurns",
      "allowedTools",
      "hooksEnabled",
      "approvalMode",
    ],
    notes: [
      "Legacy Codex runner launches with workspace-write sandboxing and fixed approve-for-me automation.",
      "Requested approvalMode is intentionally ignored until provider-specific approval mapping is implemented.",
    ],
  },
} as const satisfies ProviderManifest;

export interface CodexRuntimeResult {
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

export interface CodexRuntimeSessionRef {
  provider: typeof codexProviderManifest.id;
  sessionId: string;
}

export interface CodexProviderRuntimeResult extends CodexRuntimeResult {
  sessionRef?: CodexRuntimeSessionRef | null;
}

export interface CodexRunnerInstance {
  run(): Promise<CodexRuntimeResult>;
}

export interface CodexRunnerConstructor<TContext> {
  new (ctx: TContext): CodexRunnerInstance;
}

export interface CodexProviderAdapter<TContext> {
  readonly provider: typeof codexProviderManifest.id;
  readonly enforcement: typeof codexProviderManifest.enforcement;
  readonly resume: {
    readonly interactive: true;
    command(sessionId: string, repoPath?: string | null): string | null;
  };
  run(ctx: TContext): Promise<CodexProviderRuntimeResult>;
}

export function createCodexProviderAdapter<TContext>(args: {
  Runner: CodexRunnerConstructor<TContext>;
  buildResumeCommand: (
    provider: typeof codexProviderManifest.id,
    sessionId: string,
    repoPath?: string | null,
  ) => string | null;
}): CodexProviderAdapter<TContext> {
  return {
    provider: codexProviderManifest.id,
    enforcement: codexProviderManifest.enforcement,
    resume: {
      interactive: true,
      command: (sessionId, repoPath) =>
        args.buildResumeCommand(codexProviderManifest.id, sessionId, repoPath),
    },
    async run(ctx) {
      const runner = new args.Runner(ctx);
      const result = await runner.run();
      return {
        ...result,
        sessionRef:
          typeof result.sessionId === "string" && result.sessionId.length > 0
            ? {
                provider: codexProviderManifest.id,
                sessionId: result.sessionId,
              }
            : null,
      };
    },
  };
}
