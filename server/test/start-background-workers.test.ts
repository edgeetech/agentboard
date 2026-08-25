import { describe, expect, it, vi } from "vitest";

import { startBackgroundWorkers } from "../src/index.ts";

function createPorts() {
  return {
    startExecutor: vi.fn(),
    startSkillScanWorkers: vi.fn(() => Promise.resolve()),
    stopSkillScanWorkers: vi.fn(() => Promise.resolve()),
    reportError: vi.fn(),
  };
}

describe("startBackgroundWorkers", () => {
  it("starts executor and skill workers with the ready server context", async () => {
    const ports = createPorts();
    startBackgroundWorkers({ port: 5501, serverToken: "secret" }, ports);
    await Promise.resolve();

    expect(ports.startExecutor).toHaveBeenCalledOnce();
    expect(ports.startExecutor).toHaveBeenCalledWith({
      port: 5501,
      serverToken: "secret",
    });
    expect(ports.startSkillScanWorkers).toHaveBeenCalledOnce();
  });

  it("reports skill worker startup failure without throwing", async () => {
    const ports = createPorts();
    const error = new Error("scan startup failed");
    ports.startSkillScanWorkers.mockRejectedValueOnce(error);

    expect(() =>
      startBackgroundWorkers({ port: 5501, serverToken: "secret" }, ports),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(ports.reportError).toHaveBeenCalledWith(error);
  });

  it("stops skill workers at most once", async () => {
    const ports = createPorts();
    const handle = startBackgroundWorkers(
      { port: 5501, serverToken: "secret" },
      ports,
    );

    await Promise.all([handle.shutdown(), handle.shutdown()]);
    expect(ports.stopSkillScanWorkers).toHaveBeenCalledOnce();
  });
});
