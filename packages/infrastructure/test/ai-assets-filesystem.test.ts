import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import {
  createNodeAiAssetFilesystem,
  loadBuiltInAiAssets,
  type AiAssetDirectoryEntry,
  type AiAssetFilesystemPort,
} from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("loadBuiltInAiAssets", () => {
  it("loads built-in skills and concerns from a filesystem port", () => {
    const assets = loadBuiltInAiAssets(
      new MemoryAiAssetFilesystem({
        "ai/roles/worker.md": `---
role: worker
title: Worker
---

# Worker
`,
        "ai/skills/code-review/SKILL.md": `---
name: Code Review
description: Inspect diffs.
tags: [reviewer]
---

# Code Review
`,
        "ai/skills/refactor/SKILL.md": `---
name: Refactor
---

# Refactor
`,
        "ai/concerns/well-engineered.md": `---
title: Well Engineered
description: Engineering quality.
---

## PLANNING

### Reminders

- Write tests first.

### Review Dimensions

- test strategy
`,
      }),
      { rootPath: "ai" },
    );

    expect(assets.map((asset) => `${asset.kind}:${asset.id}`)).toEqual([
      "role:worker",
      "skill:code-review",
      "skill:refactor",
      "concern:well-engineered",
    ]);
    expect(assets[0]).toMatchObject({
      kind: "role",
      id: "worker",
      role: "worker",
    });
    expect(assets[1]).toMatchObject({
      kind: "skill",
      id: "code-review",
      name: "Code Review",
      tags: ["reviewer"],
    });
    expect(assets[3]).toMatchObject({
      kind: "concern",
      id: "well-engineered",
      phases: {
        PLANNING: {
          reminders: ["Write tests first."],
          reviewDimensions: ["test strategy"],
        },
      },
    });
  });

  it("rejects duplicate IDs within the same asset kind", () => {
    const fs = new MemoryAiAssetFilesystem({
      "ai/concerns/a.md": "---\ntitle: A\n---\n",
    });

    expect(() =>
      loadBuiltInAiAssets(
        {
          list(path) {
            if (path === "ai/roles" || path === "ai/skills") return [];
            return [
              { name: "a.md", kind: "file" },
              { name: "a.md", kind: "file" },
            ];
          },
          readText(path) {
            return fs.readText(path);
          },
        },
        { rootPath: "ai" },
      ),
    ).toThrow("Duplicate built-in AI asset concern:a");
  });

  it("loads the repository built-in AI assets through the Node filesystem adapter", () => {
    const assets = loadBuiltInAiAssets(
      createNodeAiAssetFilesystem({ rootDir: repoRoot }),
      {
        rootPath: "ai",
      },
    );

    expect(assets.map((asset) => `${asset.kind}:${asset.id}`)).toEqual([
      "role:pm",
      "role:reviewer",
      "role:worker",
      "skill:api-client",
      "skill:code-review",
      "skill:refactor",
      "skill:release-notes",
      "skill:tech-spec",
      "skill:unit-tests",
      "concern:beautiful-product",
      "concern:long-lived",
      "concern:well-engineered",
    ]);
  });

  it("rejects Node filesystem paths outside the configured root", () => {
    const fs = createNodeAiAssetFilesystem({ rootDir: repoRoot });

    expect(() => fs.readText("../package.json")).toThrow(
      "AI asset path escapes root",
    );
  });
});

class MemoryAiAssetFilesystem implements AiAssetFilesystemPort {
  readonly #files: Readonly<Record<string, string>>;

  constructor(files: Readonly<Record<string, string>>) {
    this.#files = files;
  }

  list(path: string): readonly AiAssetDirectoryEntry[] {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const entries = new Map<string, AiAssetDirectoryEntry>();

    for (const filePath of Object.keys(this.#files)) {
      if (!filePath.startsWith(prefix)) continue;
      const relative = filePath.slice(prefix.length);
      const [name, ...rest] = relative.split("/");
      if (name === undefined || name.length === 0) continue;
      entries.set(name, {
        name,
        kind: rest.length === 0 ? "file" : "directory",
      });
    }

    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  readText(path: string): string {
    const content = this.#files[path];
    if (content === undefined) throw new Error(`missing file: ${path}`);
    return content;
  }
}
