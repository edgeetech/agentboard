import { describe, expect, it } from "vitest";

import { validateProviderManifest } from "../../../packages/plugin-sdk/src/index.ts";
import {
  claudeProviderManifest,
  createClaudeProviderAdapter,
  type ClaudeRuntimeResult,
} from "../claude/src/index.ts";
import {
  codexProviderManifest,
  createCodexProviderAdapter,
  type CodexRuntimeResult,
} from "../codex/src/index.ts";
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

  it("creates a Codex adapter shell around an injected runner", async () => {
    const calls: unknown[] = [];
    class FakeCodexRunner {
      constructor(ctx: unknown) {
        calls.push(ctx);
      }

      run(): Promise<CodexRuntimeResult> {
        return Promise.resolve({
          status: "completed",
          sessionId: "codex-session",
          model: "gpt-5-codex",
        });
      }
    }

    const adapter = createCodexProviderAdapter({
      Runner: FakeCodexRunner,
      buildResumeCommand: (_provider, sessionId, repoPath) =>
        `${repoPath ?? "<none>"}:${sessionId}`,
    });

    expect(adapter.provider).toBe("codex");
    expect(adapter.enforcement).toEqual(codexProviderManifest.enforcement);
    expect(adapter.resume.command("s1", "/repo")).toBe("/repo:s1");

    await expect(adapter.run({ runId: "run-2" })).resolves.toMatchObject({
      status: "completed",
      sessionId: "codex-session",
      sessionRef: { provider: "codex", sessionId: "codex-session" },
    });
    expect(calls).toEqual([{ runId: "run-2" }]);
  });

  it("creates a Claude adapter shell around an injected runner", async () => {
    const calls: unknown[] = [];
    class FakeClaudeRunner {
      constructor(ctx: unknown) {
        calls.push(ctx);
      }

      run(): Promise<ClaudeRuntimeResult> {
        return Promise.resolve({
          status: "completed",
          sessionId: "claude-session",
          model: "claude-sonnet-4.5",
        });
      }
    }

    const adapter = createClaudeProviderAdapter({
      Runner: FakeClaudeRunner,
      buildResumeCommand: (_provider, sessionId, repoPath) =>
        `${repoPath ?? "<none>"}:${sessionId}`,
    });

    expect(adapter.provider).toBe("claude");
    expect(adapter.enforcement).toEqual(claudeProviderManifest.enforcement);
    expect(adapter.resume.command("s1", "/repo")).toBe("/repo:s1");

    await expect(adapter.run({ runId: "run-3" })).resolves.toMatchObject({
      status: "completed",
      sessionId: "claude-session",
      sessionRef: { provider: "claude", sessionId: "claude-session" },
    });
    expect(calls).toEqual([{ runId: "run-3" }]);
  });
});
