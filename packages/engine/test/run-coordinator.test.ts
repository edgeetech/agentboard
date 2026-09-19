import { describe, expect, it } from "vitest";

import {
  decideRetry,
  executeRun,
  providerId,
  type RunExecutionContext,
  type RunExecutionEvent,
  type RunExecutionPorts,
  type RunInvocationResult,
} from "../src/index.ts";

const context: RunExecutionContext = {
  run: {
    id: "run-1",
    taskId: "task-1",
    parentRunId: null,
    role: "worker",
    status: "queued",
    attempt: 1,
    token: null,
    sessionProvider: null,
    sessionId: null,
    error: null,
    summary: null,
    model: null,
    costUsd: 0,
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    lastHeartbeatAt: null,
  },
  task: {
    id: "task-1",
    projectId: "project-1",
    seq: 1,
    code: "AB-1",
    title: "Implement coordinator",
    description: null,
    acceptanceCriteriaJson: "[]",
    status: "agent_working",
    assigneeRole: "worker",
    reworkCount: 0,
    agentProviderOverride: null,
    agentConfigJson: null,
    workspacePath: null,
    discoveryMode: "full",
    version: 0,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  project: {
    id: "project-1",
    code: "AB",
    name: "AgentBoard",
    description: null,
    workflowType: "WF1",
    repoPath: "/repo",
    maxParallel: 1,
    agentProvider: providerId("claude"),
    agentConfigJson: null,
    scanIgnoreJson: "[]",
    concernsJson: "[]",
    allowGit: false,
    version: 0,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  roleConfig: { type: "single", provider: providerId("claude") },
};

function makePorts(
  result: RunInvocationResult,
  overrides: Partial<RunExecutionPorts> = {},
): RunExecutionPorts & {
  eventsSeen: RunExecutionEvent[];
  finishes: Array<Record<string, unknown>>;
  retries: Array<Record<string, unknown>>;
  costs: Array<Record<string, unknown>>;
  sessions: string[];
  heartbeatStops: number;
  cleaned: number;
} {
  const eventsSeen: RunExecutionEvent[] = [];
  const finishes: Array<Record<string, unknown>> = [];
  const retries: Array<Record<string, unknown>> = [];
  const costs: Array<Record<string, unknown>> = [];
  const sessions: string[] = [];
  const state = {
    heartbeatStops: 0,
    cleaned: 0,
  };

  const ports: RunExecutionPorts = {
    runs: {
      loadContext: () => context,
      claim: () => ({ runToken: "token-1" }),
      isClaimActive: () => true,
      recordSession: (_runId, session) => {
        sessions.push(session.sessionId);
      },
      recordCost: (_runId, cost) => {
        costs.push(cost);
      },
      finish: (input) => {
        finishes.push(input);
        return true;
      },
    },
    prompts: {
      build: () => ({ prompt: "run prompt", systemPrompt: "system prompt" }),
    },
    workspace: {
      prepare: () => ({ cwd: "/repo" }),
      cleanup: () => {
        state.cleaned += 1;
      },
    },
    runtime: {
      invoke: () => result,
    },
    heartbeat: {
      start: () => ({
        stop: () => {
          state.heartbeatStops += 1;
        },
      }),
    },
    postflight: {
      check: () => null,
    },
    retry: {
      decide: ({ attempt }) => decideRetry({ attempt }),
      schedule: (input) => {
        retries.push(input);
      },
    },
    pricing: {
      version: 7,
      findRate: () => ({ input: 1, output: 2, cacheWrite: 3, cacheRead: 4 }),
    },
    events: {
      emit: (event) => {
        eventsSeen.push(event);
      },
    },
  };

  Object.assign(ports, overrides);
  const exposed = Object.assign(ports, {
    eventsSeen,
    finishes,
    retries,
    costs,
    sessions,
  });
  Object.defineProperties(exposed, {
    heartbeatStops: { get: () => state.heartbeatStops },
    cleaned: { get: () => state.cleaned },
  });
  return exposed as RunExecutionPorts & {
    eventsSeen: RunExecutionEvent[];
    finishes: Array<Record<string, unknown>>;
    retries: Array<Record<string, unknown>>;
    costs: Array<Record<string, unknown>>;
    sessions: string[];
    heartbeatStops: number;
    cleaned: number;
  };
}

describe("engine run coordinator", () => {
  it("claims, invokes, records metadata, and completes a run", async () => {
    const ports = makePorts({
      status: "completed",
      summary: "implemented",
      model: "model-1",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 2_000_000,
        cacheCreationTokens: 3_000_000,
        cacheReadTokens: 4_000_000,
      },
      sessionRef: { provider: providerId("claude"), sessionId: "session-1" },
    });

    const result = await executeRun("run-1", ports);

    expect(result).toEqual({
      runId: "run-1",
      status: "completed",
      retryScheduled: false,
    });
    expect(ports.sessions).toEqual(["session-1"]);
    expect(ports.costs[0]).toMatchObject({
      model: "model-1",
      costUsd: 30,
      cost: { pricingVersion: 7, uncosted: false },
    });
    expect(ports.finishes).toEqual([
      {
        runId: "run-1",
        runToken: "token-1",
        status: "succeeded",
        summary: "implemented",
        error: null,
      },
    ]);
    expect(ports.eventsSeen.map((event) => event.type)).toEqual([
      "run.started",
      "run.completed",
    ]);
    expect(ports.heartbeatStops).toBe(1);
    expect(ports.cleaned).toBe(1);
  });

  it("keeps the provider outcome when session or cost recording fails", async () => {
    const ports = makePorts({
      status: "completed",
      model: "model-1",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      sessionRef: { provider: providerId("claude"), sessionId: "session-1" },
    });
    ports.runs = {
      ...ports.runs,
      recordSession: () => {
        throw new Error("session database unavailable");
      },
      recordCost: () => {
        throw new Error("cost database unavailable");
      },
    };

    const result = await executeRun("run-1", ports);

    expect(result).toMatchObject({
      status: "completed",
      retryScheduled: false,
    });
    expect(ports.finishes[0]).toMatchObject({ status: "succeeded" });
    expect(ports.eventsSeen.at(-1)?.type).toBe("run.completed");
  });

  it("returns superseded without mutation when the claim is no longer active", async () => {
    const ports = makePorts({
      status: "completed",
      model: "model-1",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      sessionRef: { provider: providerId("claude"), sessionId: "session-1" },
    });
    let postflightChecked = false;
    ports.runs = {
      ...ports.runs,
      isClaimActive: (runId, runToken) => {
        expect(runId).toBe("run-1");
        expect(runToken).toBe("token-1");
        return false;
      },
    };
    ports.postflight = {
      check: () => {
        postflightChecked = true;
        return null;
      },
    };

    const result = await executeRun("run-1", ports);

    expect(result).toEqual({
      runId: "run-1",
      status: "superseded",
      retryScheduled: false,
    });
    expect(ports.finishes).toHaveLength(0);
    expect(ports.sessions).toHaveLength(0);
    expect(ports.costs).toHaveLength(0);
    expect(ports.retries).toHaveLength(0);
    expect(postflightChecked).toBe(false);
    expect(ports.eventsSeen.map((event) => event.type)).toEqual([
      "run.started",
    ]);
  });

  it("does not retry when the conditional failure write loses its claim", async () => {
    const ports = makePorts({
      status: "failed",
      error: "provider unavailable",
      errorKind: "provider",
    });
    ports.runs = {
      ...ports.runs,
      finish: () => false,
    };

    const result = await executeRun("run-1", ports);

    expect(result).toEqual({
      runId: "run-1",
      status: "superseded",
      retryScheduled: false,
    });
    expect(ports.retries).toHaveLength(0);
    expect(ports.eventsSeen.map((event) => event.type)).toEqual([
      "run.started",
    ]);
  });

  it("finishes provider failures and schedules retryable errors", async () => {
    const ports = makePorts({
      status: "failed",
      error: "provider unavailable",
      errorKind: "provider",
    });

    const result = await executeRun("run-1", ports);

    expect(result).toMatchObject({
      runId: "run-1",
      status: "failed",
      retryScheduled: true,
      error: "provider unavailable",
    });
    expect(ports.finishes[0]).toMatchObject({
      runId: "run-1",
      status: "failed",
      error: "provider unavailable",
    });
    expect(ports.retries[0]).toMatchObject({
      runId: "run-1",
      taskId: "task-1",
      attempt: 1,
      error: "provider unavailable",
      reason: "provider",
      decision: { shouldRetry: true, nextAttempt: 2 },
    });
    expect(ports.eventsSeen.at(-1)).toMatchObject({
      type: "run.failed",
      retryScheduled: true,
    });
  });

  it("does not retry timeouts or cancellations", async () => {
    const timeoutPorts = makePorts({
      status: "failed",
      error: "turn timed out",
      errorKind: "timeout",
    });
    const cancelledPorts = makePorts({
      status: "cancelled",
      error: "cancelled by user",
    });

    const timeout = await executeRun("run-1", timeoutPorts);
    const cancelled = await executeRun("run-1", cancelledPorts);

    expect(timeout.retryScheduled).toBe(false);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      retryScheduled: false,
    });
    expect(timeoutPorts.retries).toHaveLength(0);
    expect(cancelledPorts.retries).toHaveLength(0);
    expect(cancelledPorts.finishes[0]).toMatchObject({
      status: "failed",
      error: "cancelled: cancelled by user",
    });
  });

  it("passes an AbortSignal through and classifies AbortError as cancelled", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const ports = makePorts({ status: "completed" });
    ports.runtime = {
      invoke: (input) => {
        receivedSignal = input.signal;
        const error = new Error("provider aborted");
        error.name = "AbortError";
        throw error;
      },
    };

    const result = await executeRun("run-1", ports, {
      signal: controller.signal,
    });

    expect(receivedSignal).toBe(controller.signal);
    expect(result).toMatchObject({
      status: "cancelled",
      retryScheduled: false,
    });
    expect(ports.retries).toHaveLength(0);
    expect(ports.finishes[0]).toMatchObject({
      status: "failed",
      error: "cancelled: provider aborted",
    });
  });

  it("classifies an already-aborted signal as cancelled without retry", async () => {
    const controller = new AbortController();
    controller.abort();
    const ports = makePorts({
      status: "failed",
      error: "provider stopped after cancellation",
    });

    const result = await executeRun("run-1", ports, {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      status: "cancelled",
      retryScheduled: false,
    });
    expect(ports.retries).toHaveLength(0);
    expect(ports.finishes[0]).toMatchObject({
      status: "failed",
      error: "cancelled: run aborted",
    });
  });

  it("recognizes legacy timeout messages without retrying", async () => {
    const ports = makePorts({
      status: "failed",
      error: "Turn timed out after 120000ms",
    });

    const result = await executeRun("run-1", ports);

    expect(result).toMatchObject({ status: "failed", retryScheduled: false });
    expect(ports.retries).toHaveLength(0);
    expect(ports.eventsSeen.at(-1)).toMatchObject({ reason: "timeout" });
  });

  it("does not invoke or mutate a run when claim is lost", async () => {
    let invoked = false;
    const ports = makePorts(
      { status: "completed" },
      {
        runs: {
          ...makePorts({ status: "completed" }).runs,
          claim: () => undefined,
        },
        runtime: {
          invoke: () => {
            invoked = true;
            return { status: "completed" };
          },
        },
      },
    );

    const result = await executeRun("run-1", ports);

    expect(result).toEqual({
      runId: "run-1",
      status: "not_claimed",
      retryScheduled: false,
    });
    expect(invoked).toBe(false);
    expect(ports.finishes).toHaveLength(0);
    expect(ports.eventsSeen).toHaveLength(0);
  });

  it("turns a postflight violation into a retryable failure", async () => {
    const ports = makePorts(
      { status: "completed", summary: "incomplete" },
      {
        postflight: { check: () => "missing required completion comment" },
      },
    );

    const result = await executeRun("run-1", ports);

    expect(result).toMatchObject({ status: "failed", retryScheduled: true });
    expect(ports.finishes[0]).toMatchObject({
      status: "failed",
      error: "postflight: missing required completion comment",
    });
    expect(ports.retries[0]).toMatchObject({ reason: "postflight" });
  });

  it("checks postflight with the claimed run id and token", async () => {
    const ports = makePorts({ status: "completed" });
    let checked: { runId: string; runToken: string } | undefined;
    ports.postflight = {
      check: (runId, runToken) => {
        checked = { runId, runToken };
        return null;
      },
    };

    const result = await executeRun("run-1", ports);

    expect(result.status).toBe("completed");
    expect(checked).toEqual({ runId: "run-1", runToken: "token-1" });
  });

  it("cleans up after workspace preparation was attempted and failed", async () => {
    const ports = makePorts({ status: "completed" });
    ports.workspace = {
      ...ports.workspace,
      prepare: () => {
        throw new Error("workspace unavailable");
      },
    };

    const result = await executeRun("run-1", ports);

    expect(result.status).toBe("failed");
    expect(ports.cleaned).toBe(1);
  });
});
