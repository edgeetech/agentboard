import { z } from 'zod';
import {
  providerId,
  resolveRoleConfig as resolveEngineRoleConfig,
  type AgentConfig as EngineAgentConfig,
  type RoleConfig as EngineRoleConfig,
} from '../../../../packages/engine/src/configuration/agent-config.ts';

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
  if (raw == null) return null;
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
  return toLegacyRoleConfig(
    resolveEngineRoleConfig({
      role,
      taskConfig: toEngineAgentConfig(ctx.taskConfig),
      projectConfig: toEngineAgentConfig(ctx.projectConfig),
      legacyTaskProviderOverride:
        ctx.legacyTaskOverride === null ? null : providerId(ctx.legacyTaskOverride),
      legacyProjectProvider: providerId(ctx.legacyProjectProvider),
    }),
  );
}

function toEngineAgentConfig(config: AgentConfig | null): EngineAgentConfig | null {
  return config as unknown as EngineAgentConfig | null;
}

function toLegacyRoleConfig(config: EngineRoleConfig): RoleConfig {
  if (config.type === 'single') {
    return { type: 'single', provider: config.provider as AgentProvider };
  }

  return {
    type: 'council',
    members: [...config.members] as AgentProvider[],
  };
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
  if (raw == null || raw === '') return { ok: true, value: null };
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
