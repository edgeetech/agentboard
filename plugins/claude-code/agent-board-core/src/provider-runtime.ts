import type { ProviderRateLimiter, ProviderSessionLog, TokenUsage } from './provider-types.ts';
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
  errorKind?: 'timeout' | 'error' | 'rate_limit';
  /** ISO timestamp the provider's usage limit resets, when known (errorKind='rate_limit'). */
  resetsAt?: string | null;
  /** Provider-reported auth source for this run (e.g. Claude SDK `apiKeySource`). */
  authSource?: string | null;
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

export const PROVIDER_RUNTIME_CONTROLS = [
  'cwd',
  'maxTurns',
  'allowedTools',
  'mcpServerNames',
  'hooksEnabled',
  'abortSignal',
  'rateLimitBackoff',
  'approvalMode',
  'filesystemSandbox',
] as const;

export type ProviderRuntimeControl = (typeof PROVIDER_RUNTIME_CONTROLS)[number];

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
  /**
   * Provider-agnostic policy gate. Claude runs enforce policy through the
   * PreToolUse hook; Codex/Copilot runners call this instead. Fail-closed.
   */
  toolGate?: (attempt: {
    tool: string;
    target: string;
  }) => Promise<{ decision: 'allow' | 'block'; reason: string | null }>;
  abortController: AbortController;
  rateLimiter: ProviderRateLimiter;
  sessionLog: ProviderSessionLog;
  /** Per-run MCP bearer (the run_token). Never the server token. */
  mcpBearerToken: string;
  serverPort: number;
  onEvent: (eventName: string, detail: Record<string, unknown>) => void;
  /** Whitelisted child-process environment (see child-env.ts) — never {...process.env}. */
  env: Record<string, string>;
  /** Per-provider auth mode resolved from project.auth_config_json (default 'auto'). */
  authMode?: 'subscription' | 'api_key' | 'auto';
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
