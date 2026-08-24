import { describe, expect, it } from "vitest";

import { normalizeAiAsset, parseMarkdownAsset } from "../src/index.ts";

describe("parseMarkdownAsset", () => {
  it("parses frontmatter strings, inline arrays, block arrays and body", () => {
    const parsed = parseMarkdownAsset(`---
name: Code Review
tags: [reviewer, default]
allowed_tools:
  - Read
  - Edit
---

# Body
`);

    expect(parsed.frontmatter).toEqual({
      name: "Code Review",
      tags: ["reviewer", "default"],
      "allowed-tools": ["Read", "Edit"],
    });
    expect(parsed.body).toBe("# Body\n");
  });

  it("returns raw body when frontmatter is absent or unclosed", () => {
    expect(parseMarkdownAsset("# Body").body).toBe("# Body");
    expect(parseMarkdownAsset("---\nname: x\n# Body").body).toContain("---");
  });
});

describe("normalizeAiAsset", () => {
  it("normalizes role prompts into role assets", () => {
    const asset = normalizeAiAsset({
      kind: "role",
      id: "worker",
      path: "ai/roles/worker.md",
      content: `---
role: worker
title: Worker
---

Build the task.
`,
    });

    expect(asset).toMatchObject({
      kind: "role",
      id: "worker",
      role: "worker",
      title: "Worker",
      body: "Build the task.\n",
    });
  });

  it("normalizes skill Markdown into built-in skill metadata and body", () => {
    const asset = normalizeAiAsset({
      kind: "skill",
      id: "code-review",
      path: "ai/skills/code-review.md",
      content: `---
name: Code Review
description: Inspect diffs.
emblem: CR
tags: [reviewer, default]
allowed-tools:
  - Read
---

# Code Review
`,
    });

    expect(asset).toMatchObject({
      kind: "skill",
      id: "code-review",
      name: "Code Review",
      description: "Inspect diffs.",
      emblem: "CR",
      tags: ["reviewer", "default"],
      allowedTools: ["Read"],
      body: "# Code Review\n",
    });
  });

  it("normalizes concern Markdown phase slices", () => {
    const asset = normalizeAiAsset({
      kind: "concern",
      id: "well-engineered",
      path: "ai/concerns/well-engineered.md",
      content: `---
title: Well Engineered
description: Engineering quality.
---

## PLANNING

### Reminders
- Identify risky dependencies.

### Review Dimensions
- Testability

## VERIFICATION

### Reminders
- Run relevant checks.
`,
    });

    expect(asset).toMatchObject({
      kind: "concern",
      id: "well-engineered",
      title: "Well Engineered",
      phases: {
        PLANNING: {
          reminders: ["Identify risky dependencies."],
          reviewDimensions: ["Testability"],
        },
        VERIFICATION: {
          reminders: ["Run relevant checks."],
          reviewDimensions: [],
        },
      },
    });
  });
});
