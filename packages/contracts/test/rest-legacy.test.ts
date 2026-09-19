import { describe, expect, it } from "vitest";

import {
  LEGACY_REST_ROUTES,
  PROJECT_READ_REST_ROUTES,
  TASK_REST_ROUTES,
} from "../src/index.ts";

describe("LEGACY_REST_ROUTES", () => {
  it("snapshots project mutation, skill, session and support routes", () => {
    expect(LEGACY_REST_ROUTES.map(({ id, method, path, group, responseMode }) => ({
      id,
      method,
      path,
      group,
      responseMode,
    }))).toMatchInlineSnapshot(`
      [
        {
          "group": "project",
          "id": "projects.create",
          "method": "POST",
          "path": "/api/projects",
          "responseMode": "json",
        },
        {
          "group": "project",
          "id": "projects.selectActive",
          "method": "PATCH",
          "path": "/api/projects/active",
          "responseMode": "json",
        },
        {
          "group": "project",
          "id": "projects.update",
          "method": "PATCH",
          "path": "/api/projects/:code",
          "responseMode": "json",
        },
        {
          "group": "project",
          "id": "projects.delete",
          "method": "DELETE",
          "path": "/api/projects/:code",
          "responseMode": "json",
        },
        {
          "group": "skill",
          "id": "skills.list",
          "method": "GET",
          "path": "/api/skills",
          "responseMode": "json",
        },
        {
          "group": "skill",
          "id": "skills.dirs",
          "method": "GET",
          "path": "/api/skills/dirs",
          "responseMode": "json",
        },
        {
          "group": "skill",
          "id": "skills.scanLatest",
          "method": "GET",
          "path": "/api/skills/scan/latest",
          "responseMode": "json",
        },
        {
          "group": "skill",
          "id": "skills.scanEvents",
          "method": "GET",
          "path": "/api/skills/scan/events",
          "responseMode": "sse",
        },
        {
          "group": "skill",
          "id": "skills.scan",
          "method": "POST",
          "path": "/api/skills/scan",
          "responseMode": "json",
        },
        {
          "group": "skill",
          "id": "skills.detail",
          "method": "GET",
          "path": "/api/skills/:id",
          "responseMode": "json",
        },
        {
          "group": "skill",
          "id": "skills.update",
          "method": "PUT",
          "path": "/api/skills/:id",
          "responseMode": "json",
        },
        {
          "group": "session",
          "id": "sessions.list",
          "method": "GET",
          "path": "/api/sessions",
          "responseMode": "json",
        },
        {
          "group": "session",
          "id": "sessions.events",
          "method": "GET",
          "path": "/api/sessions/:hash/events/:sessionId",
          "responseMode": "json",
        },
        {
          "group": "health",
          "id": "healthz",
          "method": "GET",
          "path": "/healthz",
          "responseMode": "json",
        },
        {
          "group": "prompt",
          "id": "prompts.detail",
          "method": "GET",
          "path": "/api/prompts/:kind/:id",
          "responseMode": "json",
        },
        {
          "group": "cost",
          "id": "costs.runs",
          "method": "GET",
          "path": "/api/projects/:code/costs",
          "responseMode": "json",
        },
        {
          "group": "cost",
          "id": "costs.total",
          "method": "GET",
          "path": "/api/projects/:code/costs/total",
          "responseMode": "json",
        },
        {
          "group": "log",
          "id": "logs.run",
          "method": "GET",
          "path": "/api/logs/:runId",
          "responseMode": "ndjson",
        },
      ]
    `);
  });

  it("keeps every REST contract id and method/path unique", () => {
    const allRoutes = [...PROJECT_READ_REST_ROUTES, ...TASK_REST_ROUTES, ...LEGACY_REST_ROUTES];

    expect(new Set(allRoutes.map((route) => route.id)).size).toBe(allRoutes.length);
    expect(new Set(allRoutes.map((route) => `${route.method} ${route.path}`)).size).toBe(
      allRoutes.length,
    );
  });
});
