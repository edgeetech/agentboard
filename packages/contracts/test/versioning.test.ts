import { describe, expect, it } from "vitest";

import {
  AGENTBOARD_API_DEPRECATION_HEADER,
  AGENTBOARD_API_SUNSET_HEADER,
  AGENTBOARD_API_VERSION_HEADER,
  CURRENT_API_SURFACES,
  validateApiSurfaceStatus,
  validateApiSurfaces,
  type ApiSurfaceStatus,
} from "../src/index.ts";

describe("API versioning contracts", () => {
  it("keeps current surface metadata policy-valid", () => {
    expect(validateApiSurfaces(CURRENT_API_SURFACES)).toEqual([]);
  });

  it("snapshots the public versioning headers", () => {
    expect({
      version: AGENTBOARD_API_VERSION_HEADER,
      deprecation: AGENTBOARD_API_DEPRECATION_HEADER,
      sunset: AGENTBOARD_API_SUNSET_HEADER,
    }).toMatchInlineSnapshot(`
      {
        "deprecation": "Deprecation",
        "sunset": "Sunset",
        "version": "AgentBoard-Api-Version",
      }
    `);
  });

  it("requires replacement and sunset metadata before marking a surface deprecated", () => {
    const deprecatedSurface = {
      id: "rest:legacy-unversioned",
      kind: "rest",
      path: "/api",
      current: true,
      versioned: false,
      deprecation: {
        deprecated: true,
        since: "2026-08-24",
      },
    } satisfies ApiSurfaceStatus;

    expect(validateApiSurfaceStatus(deprecatedSurface)).toEqual([
      "deprecated surfaces require deprecation.sunset",
      "deprecated surfaces require deprecation.replacement",
      "deprecated surfaces require deprecation.reason",
    ]);
  });

  it("rejects duplicate surface identifiers and locations", () => {
    expect(validateApiSurfaces([CURRENT_API_SURFACES[0], CURRENT_API_SURFACES[0]])).toEqual([
      "duplicate API surface id: rest:legacy-unversioned",
      "duplicate API surface location: rest:/api",
    ]);
  });
});
