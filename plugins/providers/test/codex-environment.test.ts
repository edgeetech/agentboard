import { describe, expect, it } from "vitest";

import {
  buildCodexChildEnv,
  codexChildProcessEnvironmentPolicy,
} from "../codex/src/index.ts";

describe("codex child process environment policy", () => {
  it("mirrors the host whitelist additions (proxy/CA, Copilot/Codex auth vars)", () => {
    const policy = codexChildProcessEnvironmentPolicy();

    for (const key of [
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "COPILOT_GITHUB_TOKEN",
      "COPILOT_HOME",
      "CODEX_API_KEY",
    ]) {
      expect(policy.allowedKeys).toContain(key);
    }
  });

  it("never inherits process.env implicitly", () => {
    const env = buildCodexChildEnv({
      PATH: "/bin",
      AWS_SECRET_ACCESS_KEY: "must-not-pass",
    });
    expect(env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(env).toMatchObject({ PATH: "/bin" });
  });
});
