export interface ObservabilitySnapshotContract {
  readonly process_started_at: string;
  readonly snapshot_at: string;
  readonly runs: {
    readonly started: number;
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly timeout: number;
    readonly postflight_failed: number;
    readonly retries_scheduled: number;
    readonly retries_exhausted: number;
    readonly total_duration_ms: number;
    readonly max_duration_ms: number;
  };
  readonly sse: {
    readonly active_connections: number;
    readonly total_connections: number;
    readonly disconnects: number;
    readonly replayed_events: number;
    readonly replay_failures: number;
    readonly delivery_failures: number;
    readonly heartbeats_sent: number;
  };
}

export type ObservabilitySloId =
  | "runs.failureRate"
  | "runs.timeoutRate"
  | "runs.postflightFailureRate"
  | "sse.replayFailureRate"
  | "sse.deliveryFailureRate";

export interface ObservabilitySloTarget {
  readonly id: ObservabilitySloId;
  readonly description: string;
  readonly maxRatio: number;
}

export interface ObservabilitySloResult extends ObservabilitySloTarget {
  readonly numerator: number;
  readonly denominator: number;
  readonly ratio: number;
  readonly ok: boolean;
}

export const OBSERVABILITY_SLO_TARGETS: readonly ObservabilitySloTarget[] = [
  {
    id: "runs.failureRate",
    description: "Failed or blocked terminal runs should stay below 10% of started runs.",
    maxRatio: 0.1,
  },
  {
    id: "runs.timeoutRate",
    description: "Timed-out runs should stay below 5% of started runs.",
    maxRatio: 0.05,
  },
  {
    id: "runs.postflightFailureRate",
    description: "Postflight failures should stay below 5% of started runs.",
    maxRatio: 0.05,
  },
  {
    id: "sse.replayFailureRate",
    description: "SSE replay failures should stay below 2% of replayed events.",
    maxRatio: 0.02,
  },
  {
    id: "sse.deliveryFailureRate",
    description: "SSE delivery failures should stay below 5% of total SSE connections.",
    maxRatio: 0.05,
  },
] as const;

export function evaluateObservabilitySloTargets(
  snapshot: ObservabilitySnapshotContract,
  targets: readonly ObservabilitySloTarget[] = OBSERVABILITY_SLO_TARGETS,
): readonly ObservabilitySloResult[] {
  return targets.map((target) => {
    const { numerator, denominator } = observabilityRatioParts(snapshot, target.id);
    const ratio = denominator === 0 ? 0 : numerator / denominator;
    return {
      ...target,
      numerator,
      denominator,
      ratio,
      ok: ratio <= target.maxRatio,
    };
  });
}

function observabilityRatioParts(
  snapshot: ObservabilitySnapshotContract,
  id: ObservabilitySloId,
): { numerator: number; denominator: number } {
  switch (id) {
    case "runs.failureRate":
      return { numerator: snapshot.runs.failed, denominator: snapshot.runs.started };
    case "runs.timeoutRate":
      return { numerator: snapshot.runs.timeout, denominator: snapshot.runs.started };
    case "runs.postflightFailureRate":
      return { numerator: snapshot.runs.postflight_failed, denominator: snapshot.runs.started };
    case "sse.replayFailureRate":
      return { numerator: snapshot.sse.replay_failures, denominator: snapshot.sse.replayed_events };
    case "sse.deliveryFailureRate":
      return {
        numerator: snapshot.sse.delivery_failures,
        denominator: snapshot.sse.total_connections,
      };
  }
}
