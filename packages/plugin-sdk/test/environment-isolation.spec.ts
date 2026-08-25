/**
 * Environment Isolation Tests
 *
 * Verifies that plugins cannot access environment variables
 * they haven't explicitly declared, preventing credential leakage.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Plugin Environment Isolation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set sensitive variables that should NOT be accessible
    process.env.AWS_SECRET_ACCESS_KEY = "aws-secret-should-not-leak";
    process.env.DATABASE_PASSWORD = "db-password-should-not-leak";
    process.env.GITHUB_TOKEN = "github-token-should-not-leak";
    process.env.API_KEY = "allowed-api-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("plugin only receives declared required variables", () => {
    const requiredVars = ["API_KEY"];
    const deniedPatterns = ["AWS_*", "DATABASE_*", "GITHUB_*"];

    // Simulate filtering that plugin loader would do
    const pluginEnv = filterEnvironment(
      process.env,
      requiredVars,
      [],
      deniedPatterns,
    );

    expect(pluginEnv).toHaveProperty("API_KEY", "allowed-api-key");
    expect(pluginEnv).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(pluginEnv).not.toHaveProperty("DATABASE_PASSWORD");
    expect(pluginEnv).not.toHaveProperty("GITHUB_TOKEN");
  });

  it("plugin can access declared optional variables", () => {
    process.env.LOG_LEVEL = "debug";

    const optionalVars = ["LOG_LEVEL", "CACHE_TTL"];
    const deniedPatterns = ["AWS_*"];

    const pluginEnv = filterEnvironment(
      process.env,
      [],
      optionalVars,
      deniedPatterns,
    );

    expect(pluginEnv).toHaveProperty("LOG_LEVEL", "debug");
    expect(pluginEnv).not.toHaveProperty("CACHE_TTL"); // optional but not set
  });

  it("startup fails if required variable is missing", () => {
    const requiredVars = ["MISSING_KEY"];

    const error = validateRequired(process.env, requiredVars);

    expect(error).toBeDefined();
    expect(error).toMatch(/MISSING_KEY/);
  });

  it("startup fails if denied variable is present", () => {
    const deniedPatterns = ["AWS_*", "DATABASE_*"];

    const error = validateDenied(process.env, deniedPatterns);

    expect(error).toBeDefined();
    expect(error).toMatch(/AWS_SECRET_ACCESS_KEY|DATABASE_PASSWORD/);
  });

  it("wildcard denial pattern prevents credential leakage", () => {
    process.env.AWS_ACCESS_KEY_ID = "access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "secret-key";
    process.env.AWS_SESSION_TOKEN = "session-token";

    const deniedPatterns = ["AWS_*"];

    const error = validateDenied(process.env, deniedPatterns);

    expect(error).toBeDefined();
    expect(error).toContain("AWS_");
  });

  it("multiple denied patterns work together", () => {
    const deniedPatterns = [
      "AWS_*",
      "AZURE_*",
      "GCP_*",
      "DATABASE_*",
      "GITHUB_*",
    ];

    const error = validateDenied(process.env, deniedPatterns);

    expect(error).toBeDefined();
    // Should catch at least one of the set variables
    expect(
      error?.includes("AWS_") ||
        error?.includes("DATABASE_") ||
        error?.includes("GITHUB_"),
    ).toBe(true);
  });

  it("Claude provider manifest declares correct environment", () => {
    // Example Claude provider environment declaration
    const claudeManifest = {
      required: ["CLAUDE_API_KEY"],
      optional: ["CLAUDE_LOG_LEVEL", "CLAUDE_TIMEOUT_MS"],
      denied: ["AWS_*", "AZURE_*", "DATABASE_*", "GITHUB_*"],
    };

    const pluginEnv = filterEnvironment(
      process.env,
      claudeManifest.required,
      claudeManifest.optional,
      claudeManifest.denied,
    );

    // Verify filtering worked
    expect(Object.keys(pluginEnv).every((k) => !k.startsWith("AWS_"))).toBe(
      true,
    );
    expect(Object.keys(pluginEnv).every((k) => !k.startsWith("DATABASE_"))).toBe(
      true,
    );
  });

  it("environment isolation prevents credential escalation", () => {
    // Simulate attacker trying to access higher-privilege credentials
    process.env.ADMIN_API_KEY = "admin-key-should-not-be-accessible";
    process.env.SERVICE_ACCOUNT_KEY = "service-key-should-not-be-accessible";

    const userPluginManifest = {
      required: ["USER_API_KEY"],
      optional: [],
      denied: ["ADMIN_*", "SERVICE_*"],
    };

    const error = validateDenied(
      process.env,
      userPluginManifest.denied,
    );

    // Should catch attempt to access admin/service keys
    expect(error).toBeDefined();
  });
});

/**
 * Simulates the filtering that the plugin loader performs.
 * In production, this is done by the plugin runtime before invoking the plugin.
 */
function filterEnvironment(
  env: Record<string, string | undefined>,
  required: string[],
  optional: string[],
  denied: string[],
): Record<string, string> {
  // First check denied patterns
  const error = validateDenied(env, denied);
  if (error) {
    throw new Error(error);
  }

  const filtered: Record<string, string> = {};
  const allowed = [...required, ...optional];

  for (const key of allowed) {
    if (env[key]) {
      filtered[key] = env[key]!;
    }
  }

  return filtered;
}

/**
 * Validates that required environment variables are present.
 */
function validateRequired(
  env: Record<string, string | undefined>,
  required: string[],
): string | null {
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    return `Missing required environment variables: ${missing.join(", ")}`;
  }
  return null;
}

/**
 * Validates that denied environment variables are NOT present.
 * Supports wildcard patterns like "AWS_*".
 */
function validateDenied(
  env: Record<string, string | undefined>,
  denied: string[],
): string | null {
  const presentDenied = Object.keys(env).filter((key) =>
    denied.some((pattern) => matchPattern(key, pattern)),
  );

  if (presentDenied.length > 0) {
    return `Forbidden environment variables detected: ${presentDenied.join(", ")}`;
  }

  return null;
}

/**
 * Simple wildcard pattern matching (e.g., "AWS_*" matches "AWS_SECRET_ACCESS_KEY").
 */
function matchPattern(str: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return str === pattern;

  const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
  return regex.test(str);
}
