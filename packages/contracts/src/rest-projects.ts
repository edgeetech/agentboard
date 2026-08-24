export type RestMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export type RestRouteGroup = "project" | "activity";

export type RestResponseMode = "json" | "sse";

export interface RestRouteContract {
  readonly id: string;
  readonly method: RestMethod;
  readonly path: string;
  readonly group: RestRouteGroup;
  readonly auth: "bearer";
  readonly responseMode: RestResponseMode;
  readonly description: string;
}

export type AgentProviderId = "claude" | "github_copilot" | "codex";

export type WorkflowType = "WF1" | "WF2";

export interface ProjectDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly workflow_type: WorkflowType;
  readonly repo_path: string;
  readonly max_parallel: number;
  readonly agent_provider: AgentProviderId;
  readonly agent_config_json: string | null;
  readonly concerns_json: string;
  readonly allow_git: number;
  readonly scan_ignore_json: string;
  readonly version: number;
  readonly deleted_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ListProjectsResponse {
  readonly projects: readonly ProjectDto[];
}

export interface ActiveProjectResponse {
  readonly project: ProjectDto | null;
}

export interface SuggestProjectCodeResponse {
  readonly code: string;
}

export type RunPhase =
  | "DISCOVERY"
  | "REFINEMENT"
  | "PLANNING"
  | "EXECUTING"
  | "VERIFICATION"
  | "DONE";

export interface RunActiveStateDto {
  readonly task_id: string;
  readonly task_code: string;
  readonly run_id: string | null;
  readonly run_status: string | null;
  readonly phase: RunPhase | null;
  readonly last_kind: string | null;
  readonly last_at: string | null;
  readonly debt_count: number;
}

export interface ActiveStatesResponse {
  readonly states: Record<string, RunActiveStateDto>;
}

export const PROJECT_READ_REST_ROUTES: readonly RestRouteContract[] = [
  {
    id: "projects.list",
    method: "GET",
    path: "/api/projects/list",
    group: "project",
    auth: "bearer",
    responseMode: "json",
    description: "List known project databases and their current project records.",
  },
  {
    id: "projects.active",
    method: "GET",
    path: "/api/projects/active",
    group: "project",
    auth: "bearer",
    responseMode: "json",
    description: "Return the currently selected legacy active project, when one exists.",
  },
  {
    id: "projects.suggestCode",
    method: "GET",
    path: "/api/projects/suggest-code",
    group: "project",
    auth: "bearer",
    responseMode: "json",
    description: "Suggest a project code from a candidate project name.",
  },
  {
    id: "projects.activeStates",
    method: "GET",
    path: "/api/projects/active-states",
    group: "activity",
    auth: "bearer",
    responseMode: "json",
    description: "Return board active-run state for the legacy active project.",
  },
] as const;
