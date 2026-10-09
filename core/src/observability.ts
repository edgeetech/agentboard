export type RunOutcome = 'completed' | 'failed' | 'cancelled' | 'timeout' | 'postflight_failed';

export interface ObservabilitySnapshot {
  process_started_at: string;
  snapshot_at: string;
  runs: {
    started: number;
    completed: number;
    failed: number;
    cancelled: number;
    timeout: number;
    postflight_failed: number;
    retries_scheduled: number;
    retries_exhausted: number;
    total_duration_ms: number;
    max_duration_ms: number;
  };
  sse: {
    active_connections: number;
    total_connections: number;
    disconnects: number;
    replayed_events: number;
    replay_failures: number;
    delivery_failures: number;
    heartbeats_sent: number;
  };
}

const processStartedAt = new Date();

const runs = {
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
};

const sse = {
  active_connections: 0,
  total_connections: 0,
  disconnects: 0,
  replayed_events: 0,
  replay_failures: 0,
  delivery_failures: 0,
  heartbeats_sent: 0,
};

export function recordRunStarted(): void {
  runs.started += 1;
}

export function recordRunFinished(outcome: RunOutcome, durationMs: number): void {
  runs[outcome] += 1;
  const boundedDuration = Math.max(0, Math.floor(durationMs));
  runs.total_duration_ms += boundedDuration;
  runs.max_duration_ms = Math.max(runs.max_duration_ms, boundedDuration);
}

export function runOutcomeForTerminalStatus(status: string | null | undefined): RunOutcome | null {
  if (status === 'succeeded') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed' || status === 'blocked') return 'failed';
  return null;
}

export function recordRunRetry(scheduled: boolean): void {
  if (scheduled) runs.retries_scheduled += 1;
  else runs.retries_exhausted += 1;
}

export function recordSseConnected(): void {
  sse.active_connections += 1;
  sse.total_connections += 1;
}

export function recordSseDisconnected(): void {
  sse.active_connections = Math.max(0, sse.active_connections - 1);
  sse.disconnects += 1;
}

export function recordSseReplay(count: number): void {
  sse.replayed_events += Math.max(0, Math.floor(count));
}

export function recordSseReplayFailure(): void {
  sse.replay_failures += 1;
}

export function recordSseDeliveryFailure(): void {
  sse.delivery_failures += 1;
}

export function recordSseHeartbeat(): void {
  sse.heartbeats_sent += 1;
}

export function getObservabilitySnapshot(): ObservabilitySnapshot {
  return {
    process_started_at: processStartedAt.toISOString(),
    snapshot_at: new Date().toISOString(),
    runs: { ...runs },
    sse: { ...sse },
  };
}

export function resetObservabilityForTest(): void {
  for (const key of Object.keys(runs) as (keyof typeof runs)[]) runs[key] = 0;
  for (const key of Object.keys(sse) as (keyof typeof sse)[]) sse[key] = 0;
}
