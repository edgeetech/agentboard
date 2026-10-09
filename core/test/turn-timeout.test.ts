import { describe, it, expect, vi } from 'vitest';

import { TurnTimeout, TimeoutError } from '../src/turn-timeout.ts';

describe('TurnTimeout', () => {
  it('creating a timeout gives an AbortSignal', () => {
    const tt = new TurnTimeout(1_000);
    expect(tt.signal).toBeInstanceOf(AbortSignal);
  });

  it('the signal is not aborted initially', () => {
    const tt = new TurnTimeout(1_000);
    expect(tt.signal.aborted).toBe(false);
  });

  it('clearing the timeout before it fires does not abort the signal', () => {
    vi.useFakeTimers();
    const tt = new TurnTimeout(100);
    tt.start();
    tt.clear();
    vi.advanceTimersByTime(200);
    expect(tt.signal.aborted).toBe(false);
    vi.useRealTimers();
  });

  it('signal aborts after timeout fires', () => {
    vi.useFakeTimers();
    const tt = new TurnTimeout(100);
    tt.start();
    vi.advanceTimersByTime(101);
    expect(tt.signal.aborted).toBe(true);
    expect(tt.signal.reason).toBeInstanceOf(TimeoutError);
    vi.useRealTimers();
  });

  it('parent signal abort propagates to child signal', () => {
    const parent = new AbortController();
    const tt = new TurnTimeout(5_000, parent.signal);
    parent.abort(new Error('cancelled'));
    expect(tt.signal.aborted).toBe(true);
  });

  it('already-aborted parent signal aborts child immediately', () => {
    const parent = new AbortController();
    parent.abort(new Error('already gone'));
    const tt = new TurnTimeout(5_000, parent.signal);
    expect(tt.signal.aborted).toBe(true);
  });

  it('withTimeout resolves when fn finishes before timeout', async () => {
    const result = await TurnTimeout.withTimeout(() => Promise.resolve('done'), 5_000);
    expect(result).toBe('done');
  });

  it('withTimeout rejects with TimeoutError when fn exceeds timeout', async () => {
    vi.useFakeTimers();
    const promise = TurnTimeout.withTimeout(
      () =>
        new Promise<never>(() => {
          /* never resolves */
        }),
      100,
    );
    vi.advanceTimersByTime(101);
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    vi.useRealTimers();
  });
});
