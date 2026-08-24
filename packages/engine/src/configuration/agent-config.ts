import type { RunRole } from "../domain/types.ts";

export type ProviderId = string & {
  readonly __providerIdBrand?: unique symbol;
};

export interface SingleRoleConfig {
  readonly type: "single";
  readonly provider: ProviderId;
}

export interface CouncilRoleConfig {
  readonly type: "council";
  readonly members: readonly ProviderId[];
}

export type RoleConfig = SingleRoleConfig | CouncilRoleConfig;

export type AgentConfig = Partial<Record<RunRole, RoleConfig>>;

export interface ResolveRoleConfigInput {
  readonly role: RunRole;
  readonly runProviderOverride?: ProviderId | null;
  readonly taskConfig?: AgentConfig | null;
  readonly projectConfig?: AgentConfig | null;
  readonly legacyTaskProviderOverride?: ProviderId | null;
  readonly legacyProjectProvider: ProviderId;
}

export function providerId(value: string): ProviderId {
  return value as ProviderId;
}

export function resolveRoleConfig({
  role,
  runProviderOverride = null,
  taskConfig = null,
  projectConfig = null,
  legacyTaskProviderOverride = null,
  legacyProjectProvider,
}: ResolveRoleConfigInput): RoleConfig {
  if (runProviderOverride !== null) {
    return { type: "single", provider: runProviderOverride };
  }

  const fromTask = taskConfig?.[role];
  if (fromTask !== undefined) return fromTask;

  const fromProject = projectConfig?.[role];
  if (fromProject !== undefined) return fromProject;

  if (legacyTaskProviderOverride !== null) {
    return { type: "single", provider: legacyTaskProviderOverride };
  }

  return { type: "single", provider: legacyProjectProvider };
}

export function effectiveProviderForRoleConfig(config: RoleConfig): ProviderId {
  if (config.type === "single") return config.provider;
  const synthesizer = config.members.at(-1);
  if (synthesizer === undefined) {
    throw new Error("council role config must include at least one member");
  }
  return synthesizer;
}
