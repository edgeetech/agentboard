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

export interface ProviderRuntimeLimits {
  cwd: string;
  maxTurns: number;
  allowedTools: readonly string[];
  mcpServerNames: readonly string[];
  hooksEnabled: boolean;
  abortSignal: boolean;
  rateLimitBackoff: boolean;
}

export interface ProviderSandboxPolicy {
  workspaceCwd: string;
  restrictToWorkspace: boolean;
  allowUserMcpServers: boolean;
  approvalMode: 'provider-default' | 'accept-edits' | 'approve-all' | 'disabled';
  notes: readonly string[];
}

export type ProviderRuntimeControl =
  | keyof ProviderRuntimeLimits
  | 'approvalMode'
  | 'filesystemSandbox';

export interface ProviderRuntimeEnforcement {
  enforced: readonly ProviderRuntimeControl[];
  intentionallyIgnored: readonly ProviderRuntimeControl[];
  notes: readonly string[];
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
  limits: ProviderRuntimeLimits;
  sandbox: ProviderSandboxPolicy;
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
  readonly enforcement: ProviderRuntimeEnforcement;
  run(ctx: ProviderRuntimeContext): Promise<ProviderRuntimeResult>;
}

export function buildProviderRuntimePolicy(args: {
  cwd: string;
  maxTurns: number;
  allowedTools: string;
  mcpServers: Record<string, SdkMcpServer>;
  hooks?: Record<string, unknown>;
}): { limits: ProviderRuntimeLimits; sandbox: ProviderSandboxPolicy } {
  const allowedTools = args.allowedTools
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);

  return {
    limits: {
      cwd: args.cwd,
      maxTurns: args.maxTurns,
      allowedTools,
      mcpServerNames: Object.keys(args.mcpServers).sort(),
      hooksEnabled: args.hooks !== undefined,
      abortSignal: true,
      rateLimitBackoff: true,
    },
    sandbox: {
      workspaceCwd: args.cwd,
      restrictToWorkspace: true,
      allowUserMcpServers: true,
      approvalMode: 'provider-default',
      notes: [
        'Provider adapters must declare which requested limits they enforce.',
        'Current providers may intentionally ignore unsupported controls until sandbox support is migrated.',
      ],
    },
  };
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
