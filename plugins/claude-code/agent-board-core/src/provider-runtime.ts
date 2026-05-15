import type { TokenUsage } from './agent-runner.ts';
import type { RateLimitTracker } from './rate-limit-tracker.ts';
import { sessionLogger } from './session-logger.ts';
import type { AgentProvider, RunRole } from './types.ts';

export interface SdkMcpServer {
  type?: string;
  url?: string;
  command?: string;
  args?: unknown[];
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
  tools?: string[];
  bearer_token_env_var?: string;
}

export interface ProviderSessionRef {
  provider: AgentProvider;
  sessionId: string;
}

export interface ProviderRuntimeResult {
  status: 'completed' | 'failed' | 'cancelled';
  sessionRef?: ProviderSessionRef | null;
  usage?: TokenUsage;
  model?: string | null;
  totalCostUsd?: number | null;
  error?: string;
  errorKind?: 'timeout' | 'error';
}

export interface ProviderRuntimeContext {
  runId: string;
  role: RunRole;
  prompt: string;
  systemPrompt: string;
  cwd: string;
  maxTurns: number;
  allowedTools: string;
  mcpServers: Record<string, SdkMcpServer>;
  hooks?: Record<string, unknown>;
  abortController: AbortController;
  rateLimiter: RateLimitTracker;
  sessionLog: ReturnType<typeof sessionLogger.createSessionLog>;
  serverToken: string;
  serverPort: number;
  onEvent: (eventName: string, detail: Record<string, unknown>) => void;
}

export interface ProviderResumeCapability {
  interactive: boolean;
  command: (sessionId: string, repoPath?: string | null) => string | null;
}

export interface ProviderRuntimeAdapter {
  readonly provider: AgentProvider;
  readonly resume: ProviderResumeCapability;
  run(ctx: ProviderRuntimeContext): Promise<ProviderRuntimeResult>;
}

export function buildResumeCommand(
  provider: AgentProvider,
  sessionId: string,
  repoPath?: string | null,
): string | null {
  const base =
    provider === 'codex'
      ? `codex resume ${sessionId}`
      : provider === 'github_copilot'
        ? `gh copilot -- --resume=${sessionId}`
        : `claude --resume ${sessionId}`;
  return repoPath ? `cd "${repoPath}"; ${base}` : base;
}
