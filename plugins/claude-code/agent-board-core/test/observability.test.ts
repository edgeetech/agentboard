import { beforeEach, describe, expect, it } from 'vitest';

import {
  getObservabilitySnapshot,
  recordRunFinished,
  recordRunRetry,
  recordRunStarted,
  recordSseConnected,
  recordSseDisconnected,
  recordSseHeartbeat,
  recordSseReplay,
  recordSseReplayFailure,
  resetObservabilityForTest,
  runOutcomeForTerminalStatus,
} from '../src/observability.ts';

describe('observability counters', () => {
  beforeEach(() => {
    resetObservabilityForTest();
  });

  it('records run outcomes, durations and retries', () => {
    recordRunStarted();
    recordRunFinished('completed', 125.9);
    recordRunFinished('timeout', -5);
    recordRunRetry(true);
    recordRunRetry(false);

    const snapshot = getObservabilitySnapshot();
    expect(snapshot.runs).toMatchObject({
      started: 1,
      completed: 1,
      timeout: 1,
      retries_scheduled: 1,
      retries_exhausted: 1,
      total_duration_ms: 125,
      max_duration_ms: 125,
    });
    expect(Date.parse(snapshot.process_started_at)).not.toBeNaN();
    expect(Date.parse(snapshot.snapshot_at)).not.toBeNaN();
  });

  it('maps terminal DB statuses to run outcomes', () => {
    expect(runOutcomeForTerminalStatus('succeeded')).toBe('completed');
    expect(runOutcomeForTerminalStatus('failed')).toBe('failed');
    expect(runOutcomeForTerminalStatus('blocked')).toBe('failed');
    expect(runOutcomeForTerminalStatus('cancelled')).toBe('cancelled');
    expect(runOutcomeForTerminalStatus('running')).toBeNull();
    expect(runOutcomeForTerminalStatus(undefined)).toBeNull();
  });

  it('records SSE connection lifecycle and replay metrics', () => {
    recordSseConnected();
    recordSseConnected();
    recordSseReplay(3);
    recordSseReplayFailure();
    recordSseHeartbeat();
    recordSseDisconnected();
    recordSseDisconnected();
    recordSseDisconnected();

    expect(getObservabilitySnapshot().sse).toMatchObject({
      active_connections: 0,
      total_connections: 2,
      disconnects: 3,
      replayed_events: 3,
      replay_failures: 1,
      heartbeats_sent: 1,
    });
  });
});
