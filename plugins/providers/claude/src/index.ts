import type { ProviderManifest } from "../../../../packages/plugin-sdk/src/provider.ts";
import type { ProviderRunResult } from "../../../../packages/plugin-sdk/src/runtime.ts";

export { AgentRunner } from "./runner.ts";
export type { AgentRunnerOptions } from "./runner.ts";

export const claudeProviderManifest = {
  id: "claude",
  displayName: "Claude",
  version: "0.1.0",
  runtime: { command: "claude" },
  capabilities: {
    streamingEvents: true,
    resume: "interactive",
    usage: "cost",
    tools: ["Read", "Edit", "Bash", "Grep", "Glob"],
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
    ],
    intentionallyIgnored: ["filesystemSandbox"],
    notes: [
      "Legacy Claude runner receives cwd, maxTurns, allowedTools, hooks and abort signal.",
      "Filesystem sandboxing is not enforced until provider execution moves out of the legacy core.",
    ],
  },
} as const satisfies ProviderManifest;

export type ClaudeRuntimeResult = ProviderRunResult;

export interface ClaudeRuntimeSessionRef {
  provider: typeof claudeProviderManifest.id;
  sessionId: string;
}

export interface ClaudeProviderRuntimeResult extends ClaudeRuntimeResult {
  sessionRef?: ClaudeRuntimeSessionRef | null;
}

export interface ClaudeRunnerInstance {
  run(): Promise<ClaudeRuntimeResult>;
}

export interface ClaudeRunnerConstructor<TContext> {
  new (ctx: TContext): ClaudeRunnerInstance;
}

export interface ClaudeProviderAdapter<TContext> {
  readonly manifest: typeof claudeProviderManifest;
  readonly provider: typeof claudeProviderManifest.id;
  readonly enforcement: typeof claudeProviderManifest.enforcement;
  readonly resume: {
    readonly interactive: true;
    command(sessionId: string, repoPath?: string | null): string | null;
  };
  run(ctx: TContext): Promise<ClaudeProviderRuntimeResult>;
}

export function createClaudeProviderAdapter<TContext>(args: {
  Runner: ClaudeRunnerConstructor<TContext>;
  buildResumeCommand: (
    provider: typeof claudeProviderManifest.id,
    sessionId: string,
    repoPath?: string | null,
  ) => string | null;
}): ClaudeProviderAdapter<TContext> {
  return {
    manifest: claudeProviderManifest,
    provider: claudeProviderManifest.id,
    enforcement: claudeProviderManifest.enforcement,
    resume: {
      interactive: true,
      command: (sessionId, repoPath) =>
        args.buildResumeCommand(claudeProviderManifest.id, sessionId, repoPath),
    },
    async run(ctx) {
      const runner = new args.Runner(ctx);
      const result = await runner.run();
      return {
        ...result,
        sessionRef:
          typeof result.sessionId === "string" && result.sessionId.length > 0
            ? {
                provider: claudeProviderManifest.id,
                sessionId: result.sessionId,
              }
            : null,
      };
    },
  };
}
