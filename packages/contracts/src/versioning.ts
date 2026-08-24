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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export function validateApiSurfaceStatus(surface: ApiSurfaceStatus): string[] {
  const issues: string[] = [];
  const { deprecation } = surface;

  if (!surface.current && deprecation.deprecated !== true) {
    issues.push("non-current surfaces must be marked deprecated");
  }

  if (deprecation.deprecated === true) {
    if (!deprecation.since) issues.push("deprecated surfaces require deprecation.since");
    if (!deprecation.sunset) issues.push("deprecated surfaces require deprecation.sunset");
    if (!deprecation.replacement) issues.push("deprecated surfaces require deprecation.replacement");
    if (!deprecation.reason) issues.push("deprecated surfaces require deprecation.reason");
    if (deprecation.since && !ISO_DATE_RE.test(deprecation.since)) {
      issues.push("deprecation.since must use YYYY-MM-DD");
    }
    if (deprecation.sunset && !ISO_DATE_RE.test(deprecation.sunset)) {
      issues.push("deprecation.sunset must use YYYY-MM-DD");
    }
    if (
      deprecation.since &&
      deprecation.sunset &&
      ISO_DATE_RE.test(deprecation.since) &&
      ISO_DATE_RE.test(deprecation.sunset) &&
      deprecation.sunset <= deprecation.since
    ) {
      issues.push("deprecation.sunset must be after deprecation.since");
    }
    return issues;
  }

  if (deprecation.since !== undefined) issues.push("non-deprecated surfaces must not set since");
  if (deprecation.sunset !== undefined) issues.push("non-deprecated surfaces must not set sunset");
  if (deprecation.replacement !== undefined) {
    issues.push("non-deprecated surfaces must not set replacement");
  }
  if (deprecation.reason !== undefined) issues.push("non-deprecated surfaces must not set reason");

  return issues;
}

export function validateApiSurfaces(surfaces: readonly ApiSurfaceStatus[]): string[] {
  const issues: string[] = [];
  const seenIds = new Set<ApiSurfaceId>();
  const seenLocations = new Set<string>();

  for (const surface of surfaces) {
    if (seenIds.has(surface.id)) issues.push(`duplicate API surface id: ${surface.id}`);
    seenIds.add(surface.id);

    const location = `${surface.kind}:${surface.path}`;
    if (seenLocations.has(location)) issues.push(`duplicate API surface location: ${location}`);
    seenLocations.add(location);

    for (const issue of validateApiSurfaceStatus(surface)) {
      issues.push(`${surface.id}: ${issue}`);
    }
  }

  return issues;
}
