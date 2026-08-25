import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "../plugins/claude-code/agent-board-core/node_modules/esbuild/lib/main.js";
import { format } from "../plugins/claude-code/agent-board-core/node_modules/prettier/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
const prettierConfig = JSON.parse(
  await readFile(
    join(root, "plugins", "claude-code", "agent-board-core", ".prettierrc"),
    "utf8",
  ),
);
const bundles = [
  {
    entryPoint: join(root, "packages", "plugin-sdk", "src", "registry.ts"),
    outfile: join(
      root,
      "plugins",
      "claude-code",
      "agent-board-core",
      "src",
      "generated",
      "plugin-sdk-registry.mjs",
    ),
    external: [],
  },
  {
    entryPoint: join(root, "plugins", "providers", "codex", "src", "index.ts"),
    outfile: join(
      root,
      "plugins",
      "claude-code",
      "agent-board-core",
      "src",
      "generated",
      "codex-provider.mjs",
    ),
    external: [],
  },
  {
    entryPoint: join(root, "plugins", "providers", "claude", "src", "index.ts"),
    outfile: join(
      root,
      "plugins",
      "claude-code",
      "agent-board-core",
      "src",
      "generated",
      "claude-runner.mjs",
    ),
    external: ["@anthropic-ai/claude-agent-sdk"],
  },
  {
    entryPoint: join(
      root,
      "plugins",
      "providers",
      "copilot",
      "src",
      "index.ts",
    ),
    outfile: join(
      root,
      "plugins",
      "claude-code",
      "agent-board-core",
      "src",
      "generated",
      "copilot-runner.mjs",
    ),
    external: ["@github/copilot-sdk"],
  },
];

let stale = false;
for (const bundle of bundles) {
  const result = await build({
    entryPoints: [bundle.entryPoint],
    bundle: true,
    external: bundle.external,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
  });
  const rawOutput = result.outputFiles[0]?.text;
  if (rawOutput === undefined)
    throw new Error(`No bundle output for ${bundle.entryPoint}`);
  const output = Buffer.from(
    await format(rawOutput, { ...prettierConfig, parser: "babel" }),
  );

  if (check) {
    const current = await readFile(bundle.outfile).catch(() => null);
    if (current === null || !current.equals(output)) {
      console.error(
        `${bundle.outfile} is stale; run npm run build:provider-bundles`,
      );
      stale = true;
    }
    continue;
  }

  await mkdir(dirname(bundle.outfile), { recursive: true });
  await writeFile(bundle.outfile, output);
  console.log(`Built ${bundle.outfile}`);
}

if (stale) process.exit(1);
if (check) console.log("Provider bundles are current.");
