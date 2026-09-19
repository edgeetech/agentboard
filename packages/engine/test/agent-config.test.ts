import { describe, expect, it } from "vitest";

import {
  effectiveProviderForRoleConfig,
  providerId,
  resolveRoleConfig,
  type AgentConfig,
} from "../src/index.ts";

const claude = providerId("claude");
const codex = providerId("codex");
const copilot = providerId("github_copilot");
const gemini = providerId("gemini");

describe("engine agent config resolution", () => {
  it("uses run provider override first", () => {
    const taskConfig: AgentConfig = {
      worker: { type: "single", provider: codex },
    };
    const resolved = resolveRoleConfig({
      role: "worker",
      runProviderOverride: gemini,
      taskConfig,
      legacyProjectProvider: claude,
    });
    expect(resolved).toEqual({ type: "single", provider: gemini });
  });

  it("uses task role config before project config", () => {
    const taskConfig: AgentConfig = {
      worker: { type: "single", provider: codex },
    };
    const projectConfig: AgentConfig = {
      worker: { type: "single", provider: copilot },
    };
    const resolved = resolveRoleConfig({
      role: "worker",
      taskConfig,
      projectConfig,
      legacyProjectProvider: claude,
    });
    expect(resolved).toEqual({ type: "single", provider: codex });
  });

  it("uses project role config before legacy overrides", () => {
    const projectConfig: AgentConfig = {
      reviewer: { type: "single", provider: copilot },
    };
    const resolved = resolveRoleConfig({
      role: "reviewer",
      projectConfig,
      legacyTaskProviderOverride: codex,
      legacyProjectProvider: claude,
    });
    expect(resolved).toEqual({ type: "single", provider: copilot });
  });

  it("uses legacy task provider before legacy project provider", () => {
    const resolved = resolveRoleConfig({
      role: "pm",
      legacyTaskProviderOverride: codex,
      legacyProjectProvider: claude,
    });
    expect(resolved).toEqual({ type: "single", provider: codex });
  });

  it("falls back to legacy project provider", () => {
    const resolved = resolveRoleConfig({
      role: "pm",
      legacyProjectProvider: claude,
    });
    expect(resolved).toEqual({ type: "single", provider: claude });
  });

  it("returns the final council member as the effective provider", () => {
    expect(
      effectiveProviderForRoleConfig({
        type: "council",
        members: [claude, codex, gemini],
      }),
    ).toBe(gemini);
  });

  it("supports provider ids that are not known at compile time", () => {
    const resolved = resolveRoleConfig({
      role: "worker",
      legacyProjectProvider: gemini,
    });
    expect(effectiveProviderForRoleConfig(resolved)).toBe(gemini);
  });

  it("rejects empty council effective provider lookup", () => {
    expect(() =>
      effectiveProviderForRoleConfig({
        type: "council",
        members: [],
      }),
    ).toThrow(/at least one member/);
  });
});
