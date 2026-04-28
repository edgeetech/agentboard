import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Supervisor } from '../src/supervisor.mjs';

// Yield to macrotask queue so setImmediate callbacks fire
const flushImmediate = (n = 1) =>
  new Array(n).fill(null).reduce(
    p => p.then(() => new Promise(r => setImmediate(r))),
    Promise.resolve(),
  );

describe('Supervisor', () => {
  it('starts and calls the worker fn', async () => {
    const fn = vi.fn(() => new Promise(() => {})); // hangs
    const sup = new Supervisor({ healthCheckIntervalMs: 60_000 });
    sup.start(fn);
    await flushImmediate();
    expect(fn).toHaveBeenCalledTimes(1);
    sup.stop();
  });

  it('restarts worker after crash', async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('boom'));
      return new Promise(() => {}); // hang on second call
    };
    const sup = new Supervisor({ healthCheckIntervalMs: 60_000, maxRestarts: 5 });
    sup.start(fn);
    await flushImmediate(5);
    expect(callCount).toBeGreaterThanOrEqual(2);
    sup.stop();
  });

  it('stops cleanly via stop()', async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      return Promise.reject(new Error('crash'));
    };
    const sup = new Supervisor({ healthCheckIntervalMs: 60_000, maxRestarts: 5 });
    sup.start(fn);
    await flushImmediate(2);
    sup.stop();
    const countAfterStop = callCount;
    await flushImmediate(3);
    // After stop, no further restarts
    expect(callCount).toBe(countAfterStop);
  });

  it('marks unhealthy after maxRestarts exceeded', async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      return Promise.reject(new Error(`crash #${callCount}`));
    };
    const sup = new Supervisor({
      maxRestarts: 3,
      restartWindowMs: 60_000,
      healthCheckIntervalMs: 60_000,
    });
    sup.start(fn);
    // Need maxRestarts+1 crashes: each needs one setImmediate cycle
    await flushImmediate(10);
    expect(sup.isHealthy()).toBe(false);
  });

  it('onCrash callback is invoked on each restart', async () => {
    const crashes = [];
    let count = 0;
    const fn = () => {
      count++;
      if (count <= 2) return Promise.reject(new Error(`err${count}`));
      return new Promise(() => {});
    };
    const sup = new Supervisor({
      maxRestarts: 5,
      restartWindowMs: 60_000,
      healthCheckIntervalMs: 60_000,
      onCrash: (e, n) => crashes.push({ msg: e.message, n }),
    });
    sup.start(fn);
    await flushImmediate(8);
    expect(crashes.length).toBeGreaterThanOrEqual(2);
    sup.stop();
  });

  it('getRestartCount returns count within window', async () => {
    let count = 0;
    const fn = () => {
      count++;
      if (count <= 2) return Promise.reject(new Error('crash'));
      return new Promise(() => {});
    };
    const sup = new Supervisor({ maxRestarts: 5, restartWindowMs: 60_000, healthCheckIntervalMs: 60_000 });
    sup.start(fn);
    await flushImmediate(8);
    expect(sup.getRestartCount()).toBeGreaterThanOrEqual(2);
    sup.stop();
  });
});

