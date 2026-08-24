import type { RestRouteContract } from "./rest-projects.ts";

export type TaskStatus =
  | "todo"
  | "agent_working"
  | "agent_review"
  | "human_approval"
  | "done";

export type AssigneeRole = "pm" | "worker" | "reviewer" | "human";

export type RunRole = "pm" | "worker" | "reviewer";

export type TaskRouteScope = "active-project" | "explicit-project" | "run-activity";

export interface TaskRestRouteContract extends RestRouteContract {
  readonly scope: TaskRouteScope;
}

const ACTIVE_TASK_ROUTES = [
  {
    id: "tasks.list.active",
    method: "GET",
    path: "/api/tasks",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "List tasks for the legacy active project, optionally filtered by search query.",
  },
  {
    id: "tasks.create.active",
    method: "POST",
    path: "/api/tasks",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Create a task in the legacy active project.",
  },
  {
    id: "tasks.detail.active",
    method: "GET",
    path: "/api/tasks/:id",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Read one task and its comments, file paths and recent agent runs.",
  },
  {
    id: "tasks.delete.active",
    method: "DELETE",
    path: "/api/tasks/:id",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Soft-delete a task in the legacy active project.",
  },
  {
    id: "tasks.transition.active",
    method: "POST",
    path: "/api/tasks/:id/transition",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Apply a workflow transition to a task.",
  },
  {
    id: "tasks.dispatch.active",
    method: "POST",
    path: "/api/tasks/:id/dispatch",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Dispatch a task to its next automatic role.",
  },
  {
    id: "tasks.retryFromWorker.active",
    method: "POST",
    path: "/api/tasks/:id/retry-from-worker",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Retry a rejected task from the worker role.",
  },
  {
    id: "tasks.runAgent.active",
    method: "POST",
    path: "/api/tasks/:id/run-agent",
    group: "run",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Queue an agent run for a task role.",
  },
  {
    id: "tasks.cancelRun.active",
    method: "POST",
    path: "/api/tasks/:id/cancel-run",
    group: "run",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Cancel the active or queued agent run for a task.",
  },
  {
    id: "tasks.addComment.active",
    method: "POST",
    path: "/api/tasks/:id/comments",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Add a comment to a task.",
  },
  {
    id: "tasks.cost.active",
    method: "GET",
    path: "/api/tasks/:id/cost",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Read cost totals for a task.",
  },
  {
    id: "tasks.addFilePath.active",
    method: "POST",
    path: "/api/tasks/:id/file-paths",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Attach a file path to a task.",
  },
  {
    id: "tasks.deleteFilePath.active",
    method: "DELETE",
    path: "/api/tasks/:id/file-paths/:fpId",
    group: "task",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Remove a file path from a task.",
  },
  {
    id: "board.cost.active",
    method: "GET",
    path: "/api/board/cost",
    group: "board",
    auth: "bearer",
    responseMode: "json",
    scope: "active-project",
    description: "Read board-level run cost totals for the legacy active project.",
  },
] as const satisfies readonly TaskRestRouteContract[];

function toExplicitProjectRoute(route: TaskRestRouteContract): TaskRestRouteContract {
  return {
    ...route,
    id: route.id.replace(".active", ".project"),
    path: route.path.replace("/api/", "/api/projects/:code/"),
    scope: "explicit-project",
    description: route.description.replace("legacy active project", "explicit project"),
  };
}

export const TASK_REST_ROUTES: readonly TaskRestRouteContract[] = [
  ...ACTIVE_TASK_ROUTES,
  ...ACTIVE_TASK_ROUTES.map(toExplicitProjectRoute),
  {
    id: "runs.events",
    method: "GET",
    path: "/api/runs/:id/events",
    group: "activity",
    auth: "bearer",
    responseMode: "sse",
    scope: "run-activity",
    description: "Stream activity events for a run.",
  },
  {
    id: "runs.activity",
    method: "GET",
    path: "/api/runs/:id/activity",
    group: "activity",
    auth: "bearer",
    responseMode: "json",
    scope: "run-activity",
    description: "Read persisted activity history for a run.",
  },
  {
    id: "tasks.activity",
    method: "GET",
    path: "/api/tasks/:id/activity",
    group: "activity",
    auth: "bearer",
    responseMode: "json",
    scope: "run-activity",
    description: "Read recent activity for a task card.",
  },
] as const;
