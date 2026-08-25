import { describe, expect, it, vi } from "vitest";

import { startRunWorker } from "../src/index.ts";

function createPorts() {
  let supervised: (() => Promise<void>) | null = null;
  let intervalWork: (() => void) | null = null;
  const timer = { unref: vi.fn() };
  return {
    timer,
    getSupervised: () => supervised,
    getIntervalWork: () => intervalWork,
    startSupervised: vi.fn((work: () => Promise<void>) => {
      supervised = work;
    }),
    drain: vi.fn(() => Promise.resolve()),
    reap: vi.fn(() => Promise.resolve()),
    delay: vi.fn(() => Promise.reject(new Error("stop test loop"))),
    scheduleInterval: vi.fn((work: () => void) => {
      intervalWork = work;
      return timer;
    }),
    reportError: vi.fn(),
  };
}

describe("startRunWorker", () => {
  it("starts a supervised drain loop and an unrefed reaper interval", async () => {
    const ports = createPorts();
    startRunWorker({ drainIntervalMs: 1_000, reaperIntervalMs: 60_000 }, ports);

    expect(ports.startSupervised).toHaveBeenCalledOnce();
    expect(ports.scheduleInterval).toHaveBeenCalledWith(
      expect.any(Function),
      60_000,
    );
    expect(ports.timer.unref).toHaveBeenCalledOnce();

    await expect(ports.getSupervised()?.()).rejects.toThrow("stop test loop");
    expect(ports.drain).toHaveBeenCalledOnce();
    expect(ports.delay).toHaveBeenCalledWith(1_000);
  });

  it("reports reaper failures without throwing from the timer callback", async () => {
    const ports = createPorts();
    const error = new Error("reaper failed");
    ports.reap.mockRejectedValueOnce(error);
    startRunWorker({ drainIntervalMs: 1_000, reaperIntervalMs: 60_000 }, ports);

    expect(() => ports.getIntervalWork()?.()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(ports.reportError).toHaveBeenCalledWith(error);
  });
});
