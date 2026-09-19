import { describe, expect, it, vi } from "vitest";

import { drainQueuedRunsOnce, reapProjectRunsOnce } from "../src/index.ts";

interface Project {
  maxParallel: number;
}

function createPorts() {
  const databases = {
    A: { running: 1, queued: ["a1", "a2", "a3"], orphaned: ["old"] },
    B: { running: 0, queued: ["b1"], orphaned: [] },
  };
  return {
    databases,
    listProjectCodes: vi.fn(() => ["A", "B"]),
    openProject: vi.fn(
      async (code: string) => databases[code as keyof typeof databases],
    ),
    getProject: vi.fn((): Project => ({ maxParallel: 2 })),
    maxParallel: vi.fn((project: Project) => project.maxParallel),
    runningCount: vi.fn(
      (database: (typeof databases)["A"]) => database.running,
    ),
    listQueuedRuns: vi.fn(
      (database: (typeof databases)["A"]) => database.queued,
    ),
    dispatchRun: vi.fn(() => Promise.resolve()),
    reapOrphans: vi.fn(
      (database: (typeof databases)["A"]) => database.orphaned,
    ),
    reportError: vi.fn(),
    reportReaped: vi.fn(),
  };
}

describe("run scheduler", () => {
  it("dispatches only the available max-parallel budget in queue order", async () => {
    const ports = createPorts();
    await drainQueuedRunsOnce(ports);
    await Promise.resolve();

    expect(ports.dispatchRun.mock.calls.map((call) => call[2])).toEqual([
      "a1",
      "b1",
    ]);
  });

  it("isolates project failures and continues draining later projects", async () => {
    const ports = createPorts();
    ports.openProject.mockRejectedValueOnce(new Error("A unavailable"));

    await drainQueuedRunsOnce(ports);
    await Promise.resolve();

    expect(ports.reportError).toHaveBeenCalledWith(expect.any(Error), "A");
    expect(ports.dispatchRun).toHaveBeenCalledWith(
      ports.databases.B,
      { maxParallel: 2 },
      "b1",
    );
  });

  it("reaps every project and reports non-empty orphan batches", async () => {
    const ports = createPorts();
    await reapProjectRunsOnce(120_000, ports);

    expect(ports.reapOrphans).toHaveBeenCalledWith(ports.databases.A, 120_000);
    expect(ports.reportReaped).toHaveBeenCalledWith("A", 1);
    expect(ports.reportReaped).not.toHaveBeenCalledWith("B", expect.anything());
  });
});
