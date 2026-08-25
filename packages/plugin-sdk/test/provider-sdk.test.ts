import { describe, expect, it } from "vitest";

import {
  assertProviderContract,
  createDeterministicProviderAdapter,
  createFakeProviderRequest,
  createProviderRegistry,
  createProviderRuntimeRegistry,
  ProviderTimeoutError,
  validateProviderManifest,
  toProviderRuntimeResponse,
  type ProviderAdapter,
  type ProviderManifest,
  withProviderTurnTimeout,
} from "../src/index.ts";

const validManifest: ProviderManifest = {
  id: "fake",
  displayName: "Fake Provider",
  version: "0.1.0",
  runtime: { command: "fake-agent" },
  capabilities: {
    streamingEvents: true,
    resume: "interactive",
    usage: "tokens",
    tools: ["Read"],
  },
  enforcement: {
    enforced: [
      "cwd",
      "maxTurns",
      "allowedTools",
      "mcpServerNames",
      "hooksEnabled",
      "abortSignal",
      "rateLimitBackoff",
      "approvalMode",
      "filesystemSandbox",
    ],
    intentionallyIgnored: [],
    notes: ["fake provider enforces every requested control"],
  },
};

function fakeAdapter(
  manifest: ProviderManifest = validManifest,
): ProviderAdapter {
  return {
    manifest,
    async run(request) {
      return {
        status: "completed",
        sessionId: `${request.runId}-session`,
        model: "fake-model",
        usage: { inputTokens: 1, outputTokens: 2 },
        events: [{ name: "fake.completed", detail: { role: request.role } }],
      };
    },
  };
}

describe("provider manifest validation", () => {
  it("accepts manifests that account for every runtime control", () => {
    expect(validateProviderManifest(validManifest)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("rejects manifests with undeclared controls", () => {
    const manifest: ProviderManifest = {
      ...validManifest,
      enforcement: {
        enforced: ["cwd"],
        intentionallyIgnored: [],
        notes: [],
      },
    };

    expect(validateProviderManifest(manifest).errors).toContain(
      "runtime control must be declared enforced or ignored: maxTurns",
    );
  });

  it("rejects controls declared both enforced and ignored", () => {
    const manifest: ProviderManifest = {
      ...validManifest,
      enforcement: {
        enforced: validManifest.enforcement.enforced,
        intentionallyIgnored: ["cwd"],
        notes: [],
      },
    };

    expect(validateProviderManifest(manifest).errors).toContain(
      "control cannot be both enforced and ignored: cwd",
    );
  });
});

describe("provider registry", () => {
  it("registers and resolves provider adapters by manifest id", () => {
    const registry = createProviderRegistry([fakeAdapter()]);

    expect(registry.get("fake")?.manifest.displayName).toBe("Fake Provider");
    expect(registry.require("fake").manifest.id).toBe("fake");
    expect(registry.list().map((provider) => provider.manifest.id)).toEqual([
      "fake",
    ]);
  });

  it("rejects duplicate provider ids", () => {
    const registry = createProviderRegistry([fakeAdapter()]);

    expect(() => registry.register(fakeAdapter())).toThrow(
      "Provider already registered: fake",
    );
  });
});

describe("provider runtime registry", () => {
  it("registers host-specific runtime adapters by validated manifest id", () => {
    const runtime = { manifest: validManifest, hostShape: "legacy" } as const;
    const registry = createProviderRuntimeRegistry([runtime]);

    expect(registry.require("fake")).toBe(runtime);
    expect(registry.list()).toEqual([runtime]);
    expect(() => registry.register(runtime)).toThrow(
      "Provider runtime already registered: fake",
    );
  });
});

describe("provider contract test helpers", () => {
  it("builds deterministic fake provider requests", () => {
    const request = createFakeProviderRequest({ runId: "run-123" });

    expect(request.runId).toBe("run-123");
    expect(request.limits.allowedTools).toEqual(["Read"]);
    expect(request.sandbox.restrictToWorkspace).toBe(true);
  });

  it("asserts a provider adapter can satisfy the shared contract", async () => {
    await expect(
      assertProviderContract(fakeAdapter()),
    ).resolves.toBeUndefined();
  });

  it("provides a deterministic fake provider fixture for extensibility tests", async () => {
    const provider = createDeterministicProviderAdapter({
      manifest: { id: "gemini" },
    });
    const request = createFakeProviderRequest({
      runId: "run-456",
      role: "reviewer",
    });

    const response = await provider.run(request);

    expect(provider.manifest.id).toBe("gemini");
    expect(provider.requests).toEqual([request]);
    expect(response).toMatchObject({
      status: "completed",
      sessionId: "run-456:session",
      model: "gemini:model",
      events: [
        {
          name: "provider.started",
          detail: { providerId: "gemini", runId: "run-456", role: "reviewer" },
        },
        {
          name: "provider.completed",
          detail: { providerId: "gemini", runId: "run-456" },
        },
      ],
    });
    await expect(assertProviderContract(provider)).resolves.toBeUndefined();
  });

  it("rejects providers whose response does not satisfy declared capabilities", async () => {
    const provider = createDeterministicProviderAdapter({
      response: { events: [] },
    });

    await expect(assertProviderContract(provider)).rejects.toThrow(
      "Providers declaring streamingEvents must return at least one normalized event",
    );
  });
});

describe("provider runtime support", () => {
  it("maps legacy runner-style token usage into SDK runtime responses", () => {
    expect(
      toProviderRuntimeResponse({
        status: "failed",
        sessionId: "session-1",
        model: "fake-model",
        totalCostUsd: 0.25,
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_creation_tokens: 3,
          cache_read_tokens: 4,
        },
        error: "Turn timed out after 100ms",
        errorKind: "timeout",
      }),
    ).toEqual({
      status: "failed",
      sessionId: "session-1",
      model: "fake-model",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
        costUsd: 0.25,
      },
      error: {
        kind: "timeout",
        message: "Turn timed out after 100ms",
      },
    });
  });

  it("runs work that completes before provider turn timeout", async () => {
    await expect(
      withProviderTurnTimeout(() => Promise.resolve("done"), 5_000),
    ).resolves.toBe("done");
  });

  it("rejects with ProviderTimeoutError when provider turn timeout fires", async () => {
    await expect(
      withProviderTurnTimeout(() => new Promise(() => undefined), 1),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});
