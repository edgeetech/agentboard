import { describe, expect, it } from "vitest";

import {
  OBSERVABILITY_SLO_TARGETS,
  evaluateObservabilitySloTargets,
  type ObservabilitySnapshotContract,
} from "../src/index.ts";

const EMPTY_SNAPSHOT = {
  process_started_at: "2026-08-24T00:00:00.000Z",
  snapshot_at: "2026-08-24T00:00:01.000Z",
  runs: {
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    timeout: 0,
    postflight_failed: 0,
    retries_scheduled: 0,
    retries_exhausted: 0,
    total_duration_ms: 0,
    max_duration_ms: 0,
  },
  sse: {
    active_connections: 0,
    total_connections: 0,
    disconnects: 0,
    replayed_events: 0,
    replay_failures: 0,
    delivery_failures: 0,
    heartbeats_sent: 0,
  },
} satisfies ObservabilitySnapshotContract;

describe("observability contracts", () => {
  it("snapshots initial SLO targets", () => {
    expect(OBSERVABILITY_SLO_TARGETS.map(({ id, maxRatio }) => ({ id, maxRatio })))
      .toMatchInlineSnapshot(`
        [
          {
            "id": "runs.failureRate",
            "maxRatio": 0.1,
          },
          {
            "id": "runs.timeoutRate",
            "maxRatio": 0.05,
          },
          {
            "id": "runs.postflightFailureRate",
            "maxRatio": 0.05,
          },
          {
            "id": "sse.replayFailureRate",
            "maxRatio": 0.02,
          },
          {
            "id": "sse.deliveryFailureRate",
            "maxRatio": 0.05,
          },
        ]
      `);
  });

  it("treats empty denominators as healthy zero-ratio samples", () => {
    expect(evaluateObservabilitySloTargets(EMPTY_SNAPSHOT).every((result) => result.ok)).toBe(true);
  });

  it("evaluates unhealthy run and SSE ratios", () => {
    const snapshot = {
      ...EMPTY_SNAPSHOT,
      runs: {
        ...EMPTY_SNAPSHOT.runs,
        started: 10,
        failed: 2,
        timeout: 1,
      },
      sse: {
        ...EMPTY_SNAPSHOT.sse,
        total_connections: 10,
        replayed_events: 100,
        replay_failures: 3,
        delivery_failures: 1,
      },
    } satisfies ObservabilitySnapshotContract;

    expect(
      evaluateObservabilitySloTargets(snapshot)
        .filter((result) => !result.ok)
        .map(({ id, numerator, denominator, ratio }) => ({ id, numerator, denominator, ratio })),
    ).toEqual([
      { id: "runs.failureRate", numerator: 2, denominator: 10, ratio: 0.2 },
      { id: "runs.timeoutRate", numerator: 1, denominator: 10, ratio: 0.1 },
      { id: "sse.replayFailureRate", numerator: 3, denominator: 100, ratio: 0.03 },
      { id: "sse.deliveryFailureRate", numerator: 1, denominator: 10, ratio: 0.1 },
    ]);
  });
});
