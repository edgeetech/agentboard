import { describe, expect, it } from "vitest";

import {
  classifyClaudeRateLimitEvent,
  classifyClaudeResultError,
} from "../claude/src/runner.ts";
import { classifyCodexRateLimit } from "../codex/src/index.ts";
import { classifyCopilotRateLimit } from "../copilot/src/runner.ts";

describe("Claude rate-limit classification", () => {
  it("classifies a rejected rate_limit_event with a resetsAt", () => {
    const resetsAt = Date.now() + 60_000;
    const signal = classifyClaudeRateLimitEvent({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt },
    });
    expect(signal).not.toBeNull();
    expect(signal?.resetsAt).toBe(new Date(resetsAt).toISOString());
  });

  it("ignores a non-rejected rate_limit_event", () => {
    expect(
      classifyClaudeRateLimitEvent({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed" },
      }),
    ).toBeNull();
  });

  it("classifies a system.api_retry message with a 429 status", () => {
    const signal = classifyClaudeRateLimitEvent({
      type: "system",
      subtype: "api_retry",
      error_status: 429,
      retry_delay_ms: 5_000,
    });
    expect(signal).toEqual({ resetsAt: null, retryAfterMs: 5_000 });
  });

  it("classifies an is_error result mentioning a usage limit", () => {
    const signal = classifyClaudeResultError({
      type: "result",
      is_error: true,
      result: "You've hit your usage limit for this session.",
      errors: [],
    });
    expect(signal).not.toBeNull();
  });

  it("returns null for a non-rate-limit is_error result", () => {
    expect(
      classifyClaudeResultError({
        type: "result",
        is_error: true,
        result: "Tool execution failed: file not found",
        errors: [],
      }),
    ).toBeNull();
  });

  it("returns null when is_error is false", () => {
    expect(
      classifyClaudeResultError({
        type: "result",
        is_error: false,
        result: "usage limit reached but not actually an error",
        errors: [],
      }),
    ).toBeNull();
  });
});

describe("Codex rate-limit classification", () => {
  it("classifies a JSON event carrying a usage-limit message", () => {
    const signal = classifyCodexRateLimit({
      type: "error",
      message: "You've hit your usage limit. Try again in 2 hours.",
    });
    expect(signal).not.toBeNull();
  });

  it("classifies a raw stderr chunk", () => {
    const signal = classifyCodexRateLimit(
      "Error: rate limit exceeded (429)",
    );
    expect(signal).not.toBeNull();
    expect(signal?.retryAfterMs).toBe(60_000);
  });

  it("returns null for unrelated errors", () => {
    expect(
      classifyCodexRateLimit({ type: "error", message: "network timeout" }),
    ).toBeNull();
  });
});

describe("Copilot rate-limit classification", () => {
  it("classifies a session.error event mentioning a usage limit", () => {
    const signal = classifyCopilotRateLimit({
      type: "session.error",
      data: { message: "usage limit reached", errorType: "rate_limited" },
    });
    expect(signal).not.toBeNull();
  });

  it("returns null for unrelated session errors", () => {
    expect(
      classifyCopilotRateLimit({
        type: "session.error",
        data: { message: "tool execution failed" },
      }),
    ).toBeNull();
  });
});
