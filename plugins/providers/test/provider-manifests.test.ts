import { describe, expect, it } from "vitest";

import { validateProviderManifest } from "../../../packages/plugin-sdk/src/index.ts";
import { claudeProviderManifest } from "../claude/src/index.ts";
import { codexProviderManifest } from "../codex/src/index.ts";
import { copilotProviderManifest } from "../copilot/src/index.ts";

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
});
