import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizeAiAsset, type AiAssetSource } from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const aiRoot = join(repoRoot, "ai");

describe("built-in AI asset sources", () => {
  it("normalizes every built-in role Markdown file", () => {
    const roles = readRoleSources();

    expect(roles.map((role) => role.id).sort()).toEqual([
      "pm",
      "reviewer",
      "worker",
    ]);

    for (const source of roles) {
      const asset = normalizeAiAsset(source);
      expect(asset.kind).toBe("role");
      expect(asset.id).toBe(source.id);
      expect(asset.path).toBe(source.path);
      expect(asset.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("normalizes every built-in skill Markdown file", () => {
    const skills = readSkillSources();

    expect(skills.map((skill) => skill.id).sort()).toEqual([
      "api-client",
      "code-review",
      "refactor",
      "release-notes",
      "tech-spec",
      "unit-tests",
    ]);

    for (const source of skills) {
      const asset = normalizeAiAsset(source);
      expect(asset.kind).toBe("skill");
      expect(asset.id).toBe(source.id);
      expect(asset.path).toBe(source.path);
      expect(asset.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("normalizes every built-in concern Markdown file with phase slices", () => {
    const concerns = readConcernSources();

    expect(concerns.map((concern) => concern.id).sort()).toEqual([
      "beautiful-product",
      "long-lived",
      "well-engineered",
    ]);

    for (const source of concerns) {
      const asset = normalizeAiAsset(source);
      expect(asset.kind).toBe("concern");
      expect(asset.id).toBe(source.id);
      expect(Object.keys(asset.phases).length).toBeGreaterThan(0);
    }
  });
});

function readRoleSources(): AiAssetSource[] {
  const rolesDir = join(aiRoot, "roles");
  return readdirSync(rolesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const id = basename(entry.name, ".md");
      const path = `ai/roles/${entry.name}`;
      return {
        kind: "role",
        id,
        path,
        content: readFileSync(join(repoRoot, path), "utf8"),
      };
    });
}

function readSkillSources(): AiAssetSource[] {
  const skillsDir = join(aiRoot, "skills");
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = `ai/skills/${entry.name}/SKILL.md`;
      return {
        kind: "skill",
        id: entry.name,
        path,
        content: readFileSync(join(repoRoot, path), "utf8"),
      };
    });
}

function readConcernSources(): AiAssetSource[] {
  const concernsDir = join(aiRoot, "concerns");
  return readdirSync(concernsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const id = basename(entry.name, ".md");
      const path = `ai/concerns/${entry.name}`;
      return {
        kind: "concern",
        id,
        path,
        content: readFileSync(join(repoRoot, path), "utf8"),
      };
    });
}
