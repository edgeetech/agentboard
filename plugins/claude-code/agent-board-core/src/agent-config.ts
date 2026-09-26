import { z } from 'zod';

import {
  AGENT_PROVIDERS,
  type AgentConfig,
  type AgentProvider,
  type RoleConfig,
  type RunRole,
  COUNCIL_MIN,
  COUNCIL_MAX,
} from './types.ts';

const providerSchema = z.enum(AGENT_PROVIDERS as readonly [AgentProvider, ...AgentProvider[]]);

const singleRoleSchema = z.object({
  type: z.literal('single'),
  provider: providerSchema,
});

const councilRoleSchema = z.object({
  type: z.literal('council'),
  members: z.array(providerSchema).min(COUNCIL_MIN).max(COUNCIL_MAX),
});

const roleConfigSchema = z.discriminatedUnion('type', [singleRoleSchema, councilRoleSchema]);

export const agentConfigSchema = z
  .object({
    pm: roleConfigSchema.optional(),
    worker: roleConfigSchema.optional(),
    reviewer: roleConfigSchema.optional(),
  })
  .strict();

export function parseAgentConfig(raw: unknown): AgentConfig | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const result = agentConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function stringifyAgentConfig(cfg: AgentConfig | null | undefined): string | null {
  if (!cfg) return null;
  const parsed = agentConfigSchema.safeParse(cfg);
  if (!parsed.success) return null;
  return JSON.stringify(parsed.data);
}

export interface ResolveContext {
  taskConfig: AgentConfig | null;
  projectConfig: AgentConfig | null;
  legacyTaskOverride: AgentProvider | null;
  legacyProjectProvider: AgentProvider;
}

export function resolveRoleConfig(role: RunRole, ctx: ResolveContext): RoleConfig {
  const fromTask = ctx.taskConfig?.[role];
  if (fromTask !== undefined) return cloneRoleConfig(fromTask);

  const fromProject = ctx.projectConfig?.[role];
  if (fromProject !== undefined) return cloneRoleConfig(fromProject);

  if (ctx.legacyTaskOverride !== null) return { type: 'single', provider: ctx.legacyTaskOverride };
  return { type: 'single', provider: ctx.legacyProjectProvider };
}

function cloneRoleConfig(config: RoleConfig): RoleConfig {
  if (config.type === 'single') return { type: 'single', provider: config.provider };
  return { type: 'council', members: [...config.members] };
}

export function describeRoleConfig(cfg: RoleConfig): string {
  if (cfg.type === 'single') return providerLabel(cfg.provider);
  return `Council: ${cfg.members.map(providerLabel).join(' → ')}`;
}

export function providerLabel(p: AgentProvider): string {
  switch (p) {
    case 'claude':
      return 'Claude';
    case 'github_copilot':
      return 'Copilot';
    case 'codex':
      return 'Codex';
  }
}

export function validateAgentConfigInput(
  raw: unknown,
): { ok: true; value: AgentConfig | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
    }
  }
  const result = agentConfigSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { ok: true, value: result.data };
}

// ── Per-provider auth mode ──────────────────────────────────────────────────
// Controls whether a provider run authenticates via the user's interactive
// subscription (OAuth login) or an explicit API key. Default 'auto' preserves
// current behaviour (whatever the CLI resolves with the whitelisted env).

export const AUTH_MODES = ['subscription', 'api_key', 'auto'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface AuthConfig {
  claude?: AuthMode | undefined;
  codex?: AuthMode | undefined;
  github_copilot?: AuthMode | undefined;
}

const authModeSchema = z.enum(AUTH_MODES);

export const authConfigSchema = z
  .object({
    claude: authModeSchema.optional(),
    codex: authModeSchema.optional(),
    github_copilot: authModeSchema.optional(),
  })
  .strict();

export function parseAuthConfig(raw: unknown): AuthConfig | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const result = authConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function stringifyAuthConfig(cfg: AuthConfig | null | undefined): string | null {
  if (!cfg) return null;
  const parsed = authConfigSchema.safeParse(cfg);
  if (!parsed.success) return null;
  return JSON.stringify(parsed.data);
}

export function validateAuthConfigInput(
  raw: unknown,
): { ok: true; value: AuthConfig | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
    }
  }
  const result = authConfigSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { ok: true, value: result.data };
}

export function resolveAuthMode(provider: AgentProvider, cfg: AuthConfig | null): AuthMode {
  if (cfg === null) return 'auto';
  return cfg[provider] ?? 'auto';
}

/** Env vars stripped in 'subscription' mode so a stray API key can't override OAuth login. */
export const PROVIDER_API_KEY_ENV_VARS: Record<AgentProvider, readonly string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'],
  github_copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
};

/** Subset of the above whose presence proves a usable key (excludes base-URL config vars). */
export const PROVIDER_API_KEY_REQUIRED_VARS: Record<AgentProvider, readonly string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  github_copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
};

export function stripApiKeyEnvVars(
  env: Record<string, string>,
  provider: AgentProvider,
): Record<string, string> {
  const excluded = new Set<string>(PROVIDER_API_KEY_ENV_VARS[provider]);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !excluded.has(key)));
}

export function hasApiKeyEnvVar(
  env: Record<string, string | undefined>,
  provider: AgentProvider,
): boolean {
  return PROVIDER_API_KEY_REQUIRED_VARS[provider].some(
    (key) => typeof env[key] === 'string' && env[key] !== '',
  );
}
