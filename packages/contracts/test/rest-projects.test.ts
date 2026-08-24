import { describe, expect, it } from "vitest";

import { PROJECT_READ_REST_ROUTES, type ProjectDto } from "../src/index.ts";

describe("PROJECT_READ_REST_ROUTES", () => {
  it("snapshots current read-only project routes", () => {
    expect(PROJECT_READ_REST_ROUTES).toMatchInlineSnapshot(`
      [
        {
          "auth": "bearer",
          "description": "List known project databases and their current project records.",
          "group": "project",
          "id": "projects.list",
          "method": "GET",
          "path": "/api/projects/list",
          "responseMode": "json",
        },
        {
          "auth": "bearer",
          "description": "Return the currently selected legacy active project, when one exists.",
          "group": "project",
          "id": "projects.active",
          "method": "GET",
          "path": "/api/projects/active",
          "responseMode": "json",
        },
        {
          "auth": "bearer",
          "description": "Suggest a project code from a candidate project name.",
          "group": "project",
          "id": "projects.suggestCode",
          "method": "GET",
          "path": "/api/projects/suggest-code",
          "responseMode": "json",
        },
        {
          "auth": "bearer",
          "description": "Return board active-run state for the legacy active project.",
          "group": "activity",
          "id": "projects.activeStates",
          "method": "GET",
          "path": "/api/projects/active-states",
          "responseMode": "json",
        },
      ]
    `);
  });

  it("keeps project DTOs aligned with the runtime project row surface", () => {
    const project = {
      id: "project_1",
      code: "DEMO",
      name: "Demo",
      description: null,
      workflow_type: "WF1",
      repo_path: "C:/Workspace/demo",
      max_parallel: 1,
      agent_provider: "claude",
      agent_config_json: null,
      concerns_json: "[]",
      allow_git: 0,
      scan_ignore_json: "[]",
      version: 0,
      deleted_at: null,
      created_at: "2026-08-24T00:00:00.000Z",
      updated_at: "2026-08-24T00:00:00.000Z",
    } satisfies ProjectDto;

    expect(project).toMatchObject({
      code: "DEMO",
      workflow_type: "WF1",
      agent_provider: "claude",
    });
  });
});
