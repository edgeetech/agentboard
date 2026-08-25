import { describe, expect, it } from "vitest";

import {
  copilotProviderManifest,
  createCopilotProviderAdapter,
  type CopilotRuntimeResult,
} from "../src/index.ts";

describe("Copilot provider adapter shell", () => {
  it("wraps an injected runner without importing legacy runtime internals", async () => {
    const calls: unknown[] = [];
    class FakeCopilotRunner {
      constructor(ctx: unknown) {
        calls.push(ctx);
      }

      run(): Promise<CopilotRuntimeResult> {
        return Promise.resolve({
          status: "completed",
          sessionId: "copilot-session",
          model: "gpt-5-mini",
        });
      }
    }

    const adapter = createCopilotProviderAdapter({
      Runner: FakeCopilotRunner,
      buildResumeCommand: (_provider, sessionId, repoPath) =>
        `${repoPath ?? "<none>"}:${sessionId}`,
    });

    expect(adapter.provider).toBe("github_copilot");
    expect(adapter.manifest).toBe(copilotProviderManifest);
    expect(adapter.enforcement).toEqual(copilotProviderManifest.enforcement);
    expect(adapter.resume.command("s1", "/repo")).toBe("/repo:s1");

    await expect(adapter.run({ runId: "run-1" })).resolves.toMatchObject({
      status: "completed",
      sessionId: "copilot-session",
      sessionRef: { provider: "github_copilot", sessionId: "copilot-session" },
    });
    expect(calls).toEqual([{ runId: "run-1" }]);
  });
});
