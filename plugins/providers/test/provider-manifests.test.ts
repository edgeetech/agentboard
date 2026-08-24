import { describe, expect, it } from "vitest";

import { validateProviderManifest } from "../../../packages/plugin-sdk/src/index.ts";
import { claudeProviderManifest } from "../claude/src/index.ts";
import { codexProviderManifest } from "../codex/src/index.ts";
import {
  copilotProviderManifest,
  createCopilotProviderAdapter,
  type CopilotRuntimeResult,
} from "../copilot/src/index.ts";

const manifests = [
  claudeProviderManifest,
  codexProviderManifest,
  copilotProviderManifest,
] as const;

describe("provider package manifests", () => {
  it("declare unique provider ids", () => {
    expect(manifests.map((manifest) => manifest.id).sort()).toEqual([
      "claude",
      "codex",
      "github_copilot",
    ]);
  });

  it("satisfy the shared plugin SDK manifest contract", () => {
    for (const manifest of manifests) {
      expect(validateProviderManifest(manifest)).toEqual({
        ok: true,
        errors: [],
      });
    }
  });

  it("creates a Copilot adapter shell around an injected runner", async () => {
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
