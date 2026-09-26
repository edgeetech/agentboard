import { describe, expect, it } from "vitest";

import { buildCopilotClientOptions } from "../src/runner.ts";

describe("buildCopilotClientOptions", () => {
  it("subscription mode forces the logged-in user and passes no token", () => {
    const options = buildCopilotClientOptions({ PATH: "/bin" }, "subscription");
    expect(options.useLoggedInUser).toBe(true);
    expect(options.gitHubToken).toBeUndefined();
    expect(options.env).toEqual({ PATH: "/bin" });
  });

  it("api_key mode forwards the first available token var and disables useLoggedInUser", () => {
    const options = buildCopilotClientOptions(
      { PATH: "/bin", COPILOT_GITHUB_TOKEN: "cop-token", GH_TOKEN: "gh-token" },
      "api_key",
    );
    expect(options.gitHubToken).toBe("cop-token");
    expect(options.useLoggedInUser).toBe(false);
  });

  it("api_key mode fails fast when no token var is set", () => {
    expect(() => buildCopilotClientOptions({ PATH: "/bin" }, "api_key")).toThrow(
      /api_key/,
    );
  });

  it("auto mode passes the env through unchanged with no explicit auth override", () => {
    const options = buildCopilotClientOptions({ PATH: "/bin", GH_TOKEN: "x" }, "auto");
    expect(options.gitHubToken).toBeUndefined();
    expect(options.useLoggedInUser).toBeUndefined();
    expect(options.env).toEqual({ PATH: "/bin", GH_TOKEN: "x" });
  });
});
