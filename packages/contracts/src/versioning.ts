export type ApiSurfaceId =
  | "rest:legacy-unversioned"
  | "mcp:http-unversioned"
  | "mcp:stdio-unversioned";

export type ApiSurfaceKind = "rest" | "mcp";

export interface ApiDeprecation {
  readonly deprecated: boolean;
  readonly since?: string;
  readonly sunset?: string;
  readonly replacement?: string;
  readonly reason?: string;
}

export interface ApiSurfaceStatus {
  readonly id: ApiSurfaceId;
  readonly kind: ApiSurfaceKind;
  readonly path: string;
  readonly current: boolean;
  readonly versioned: boolean;
  readonly deprecation: ApiDeprecation;
}

export const AGENTBOARD_API_VERSION_HEADER = "AgentBoard-Api-Version" as const;
export const AGENTBOARD_API_DEPRECATION_HEADER = "Deprecation" as const;
export const AGENTBOARD_API_SUNSET_HEADER = "Sunset" as const;

export const CURRENT_API_SURFACES: readonly ApiSurfaceStatus[] = [
  {
    id: "rest:legacy-unversioned",
    kind: "rest",
    path: "/api",
    current: true,
    versioned: false,
    deprecation: { deprecated: false },
  },
  {
    id: "mcp:http-unversioned",
    kind: "mcp",
    path: "/mcp",
    current: true,
    versioned: false,
    deprecation: { deprecated: false },
  },
  {
    id: "mcp:stdio-unversioned",
    kind: "mcp",
    path: "plugins/claude-code/mcp/agentboard.mjs",
    current: true,
    versioned: false,
    deprecation: { deprecated: false },
  },
] as const;
