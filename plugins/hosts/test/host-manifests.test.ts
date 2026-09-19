import { describe, expect, it } from "vitest";

import { validateHostIntegrationManifest } from "../../../packages/plugin-sdk/src/index.ts";
import { claudeCodeHostManifest } from "../claude-code/src/index.ts";
import { codexHostManifest } from "../codex/src/index.ts";
import { copilotHostManifest } from "../copilot/src/index.ts";

const manifests = [
  claudeCodeHostManifest,
  codexHostManifest,
  copilotHostManifest,
] as const;

describe("host integration manifests", () => {
  it("declare unique host ids", () => {
    expect(manifests.map((manifest) => manifest.id).sort()).toEqual([
      "claude-code",
      "codex",
      "copilot",
    ]);
  });

  it("satisfy the shared plugin SDK host manifest contract", () => {
    for (const manifest of manifests) {
      expect(validateHostIntegrationManifest(manifest)).toEqual({
        ok: true,
        errors: [],
      });
    }
  });

  it("rejects blank legacy host paths", () => {
    expect(
      validateHostIntegrationManifest({
        ...claudeCodeHostManifest,
        legacyPath: " ",
      }),
    ).toEqual({
      ok: false,
      errors: ["legacy-active host manifests must declare legacyPath"],
    });
  });
});
