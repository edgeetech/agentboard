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
  const fromTask = ctx.taskConfig?.[role];
  if (fromTask) return fromTask;
  const fromProject = ctx.projectConfig?.[role];
  if (fromProject) return fromProject;
  if (ctx.legacyTaskOverride) {
    return { type: 'single', provider: ctx.legacyTaskOverride };
  }
  return { type: 'single', provider: ctx.legacyProjectProvider };
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

export function validateAgentConfigInput(raw: unknown): { ok: true; value: AgentConfig | null } | { ok: false; error: string } {
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
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  return { ok: true, value: result.data };
}
