import { describe, expect, it } from "vitest";

import {
  evaluateProviderToolAttempt,
  ProviderToolDeniedError,
  type ProviderToolGate,
} from "../../../packages/plugin-sdk/src/runtime.ts";
import {
  codexProviderManifest,
  extractCodexToolAttempt,
} from "../codex/src/index.ts";
import {
  copilotProviderManifest,
  extractCopilotToolAttempt,
} from "../copilot/src/index.ts";

// Mirrors the server-side policy (tool-policy.ts) closely enough to prove the
// wiring: a denied shell category never gets an `allow`.
const DENY_SHELL = /(^|[;&|])\s*(rm|gh|git\s+push|git\s+reset|git\s+clean)\b/;
const policyGate: ProviderToolGate = ({ tool, target }) =>
  tool === "Bash" && DENY_SHELL.test(target)
    ? { decision: "block", reason: "destructive command blocked" }
    : { decision: "allow", reason: null };

describe("codex tool-attempt extraction", () => {
  it.each([
    [{ type: "exec_command_begin", command: ["rm", "-rf", "src"] }, "rm -rf src"],
    [
      {
        type: "item.started",
        item: { type: "command_execution", command: "git push origin main" },
      },
      "git push origin main",
    ],
    [
      { type: "turn.tool_call", tool_name: "shell", arguments: { command: "gh pr merge 1" } },
      "gh pr merge 1",
    ],
  ])("reads the command out of %j", (event, expected) => {
    const attempt = extractCodexToolAttempt(event as Record<string, unknown>);
    expect(attempt).toEqual({ tool: "Bash", target: expected });
  });

  it("recognises patch application as an Edit", () => {
    expect(
      extractCodexToolAttempt({ type: "patch_apply_begin", path: "src/a.ts" }),
    ).toEqual({ tool: "Edit", target: "src/a.ts" });
  });

  it("ignores non-tool events", () => {
    expect(extractCodexToolAttempt({ type: "turn.completed" })).toBeNull();
    expect(extractCodexToolAttempt({ type: "agent_message" })).toBeNull();
  });
});

describe("copilot tool-attempt extraction", () => {
  it("reads a shell tool call", () => {
    expect(
      extractCopilotToolAttempt({
        type: "assistant.tool_call",
        data: { name: "shell", arguments: '{"command":"rm -rf dist"}' },
      }),
    ).toEqual({ tool: "Bash", target: "rm -rf dist" });
  });

  it("reads a write tool call", () => {
    expect(
      extractCopilotToolAttempt({
        type: "tool.invoked",
        data: { toolName: "str_replace_editor", arguments: { path: "src/a.ts" } },
      }),
    ).toEqual({ tool: "Edit", target: "src/a.ts" });
  });

  it("ignores non-tool events", () => {
    expect(extractCopilotToolAttempt({ type: "session.model_change" })).toBeNull();
  });
});

describe("a codex run cannot execute a denied tool category", () => {
  it.each([
    { type: "exec_command_begin", command: ["rm", "-rf", "src"] },
    { type: "item.started", item: { type: "command_execution", command: "git push --force" } },
    { type: "item.started", item: { type: "command_execution", command: "npm test && rm -rf ." } },
  ])("denies %j at the runner boundary", async (event) => {
    const attempt = extractCodexToolAttempt(event as Record<string, unknown>);
    expect(attempt).not.toBeNull();
    const verdict = await evaluateProviderToolAttempt(policyGate, attempt!);
    expect(verdict.decision).toBe("block");
    // The runner turns a block into an abort of the whole run.
    expect(new ProviderToolDeniedError(attempt!, verdict.reason).message).toContain(
      "tool denied by agentboard policy",
    );
  });

  it("still allows an ordinary build command", async () => {
    const attempt = extractCodexToolAttempt({
      type: "item.started",
      item: { type: "command_execution", command: "npm run build" },
    });
    await expect(evaluateProviderToolAttempt(policyGate, attempt!)).resolves.toEqual({
      decision: "allow",
      reason: null,
    });
  });
});

describe("evaluateProviderToolAttempt fails closed", () => {
  const attempt = { tool: "Bash", target: "npm test" };

  it("denies when the gate throws", async () => {
    const verdict = await evaluateProviderToolAttempt(() => {
      throw new Error("server unreachable");
    }, attempt);
    expect(verdict.decision).toBe("block");
    expect(verdict.reason).toContain("server unreachable");
  });

  it("denies when the gate rejects", async () => {
    const verdict = await evaluateProviderToolAttempt(
      () => Promise.reject(new Error("ECONNREFUSED")),
      attempt,
    );
    expect(verdict.decision).toBe("block");
    expect(verdict.reason).toContain("ECONNREFUSED");
  });

  it("denies an unrecognised decision", async () => {
    const verdict = await evaluateProviderToolAttempt(
      () => ({ decision: "maybe" }) as unknown as { decision: "allow"; reason: null },
      attempt,
    );
    expect(verdict.decision).toBe("block");
    expect(verdict.reason).toContain("unrecognised");
  });

  it("allows only on an explicit allow", async () => {
    await expect(
      evaluateProviderToolAttempt(() => ({ decision: "allow", reason: null }), attempt),
    ).resolves.toEqual({ decision: "allow", reason: null });
  });
});

describe("provider manifests declare allowedTools as enforced", () => {
  it.each([codexProviderManifest, copilotProviderManifest])("$id", (manifest) => {
    expect(manifest.enforcement.enforced).toContain("allowedTools");
    expect(manifest.enforcement.intentionallyIgnored).not.toContain("allowedTools");
  });
});
