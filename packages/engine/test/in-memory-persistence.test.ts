import { describe, expect, it } from "vitest";

import { createInMemoryPersistence, providerId, type ProjectRecord } from "../src/index.ts";

const seededProject: ProjectRecord = {
  id: "p1",
  code: "PRJ",
  name: "Project",
  description: null,
  workflowType: "WF1",
  repoPath: "/repo",
  maxParallel: 1,
  agentProvider: providerId("claude"),
  agentConfigJson: null,
  scanIgnoreJson: "[]",
  concernsJson: "[]",
  allowGit: false,
  version: 2,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("createInMemoryPersistence", () => {
  it("updates the current project with optimistic concurrency", () => {
    const persistence = createInMemoryPersistence({ project: seededProject });

    expect(persistence.projects.updateCurrent(1, { name: "Wrong" })).toEqual({
      ok: false,
      reason: "version mismatch",
    });

    const result = persistence.projects.updateCurrent(2, {
      name: "Renamed",
      agentProvider: providerId("codex"),
    });

    expect(result).toMatchObject({
      ok: true,
      project: { name: "Renamed", agentProvider: providerId("codex"), version: 3 },
    });
  });

  it("creates, lists and transitions tasks", () => {
    const persistence = createInMemoryPersistence({ project: seededProject });
    const task = persistence.tasks.create({
      title: "Implement persistence",
      assigneeRole: "worker",
    });

    expect(task).toMatchObject({
      code: "PRJ-1",
      status: "todo",
      assigneeRole: "worker",
    });
    expect(persistence.tasks.getByCode("PRJ-1")?.id).toBe(task.id);

    const transitioned = persistence.tasks.transition({
      taskId: task.id,
      expectedVersion: 0,
      toStatus: "agent_working",
      toAssignee: "worker",
      byRole: "pm",
    });

    expect(transitioned).toMatchObject({
      ok: true,
      task: { status: "agent_working", version: 1 },
    });
    expect(persistence.tasks.transition({
      taskId: task.id,
      expectedVersion: 0,
      toStatus: "done",
      toAssignee: "human",
      byRole: "human",
    })).toEqual({ ok: false, reason: "version mismatch" });
  });

  it("tracks queued runs, finishes runs and records comments", () => {
    const persistence = createInMemoryPersistence({ project: seededProject });
    const task = persistence.tasks.create({ title: "Run task" });
    const runId = persistence.runs.enqueue(task.id, "worker");

    expect(persistence.runs.listQueued().map((run) => run.id)).toEqual([runId]);
    expect(persistence.runs.listForTask(task.id)).toHaveLength(1);

    persistence.runs.finish(runId, "succeeded", "done", null);
    expect(persistence.runs.getById(runId)).toMatchObject({
      status: "succeeded",
      summary: "done",
    });

    const comment = persistence.comments.add(task.id, "worker", "DEV_COMPLETED");
    expect(persistence.comments.listForTask(task.id)).toEqual([comment]);
  });
});
