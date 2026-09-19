import type { ProviderManifest } from "../../../../packages/plugin-sdk/src/provider.ts";
import type { ProviderRunResult } from "../../../../packages/plugin-sdk/src/runtime.ts";

export { CodexRunner, buildCodexExecArgs } from "./runner.ts";
export type { CodexRunnerOptions } from "./runner.ts";
export {
  codexBridgedClaudeMcps,
  codexReferencedEnvKeys,
  inheritedUserMcpKeys,
  inheritedUserMcpServers,
  quoteTomlPathKey,
  quoteTomlString,
  readClaudeUserMcpServers,
  readCodexConfig,
} from "./config.ts";
export type { CodexConfig, CodexMcpServerEntry } from "./config.ts";
export {
  buildCodexChildEnv,
  codexChildProcessEnvironmentPolicy,
} from "./environment.ts";

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

export type CodexRuntimeResult = ProviderRunResult;

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
  readonly manifest: typeof codexProviderManifest;
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
    manifest: codexProviderManifest,
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
