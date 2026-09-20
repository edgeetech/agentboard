import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const uiRoot = join(root, "apps", "ui");
const source = join(uiRoot, "dist");
const target = join(
  root,
  "plugins",
  "claude-code",
  "agent-board-core",
  "ui",
  "dist",
);
const stampPath = join(target, ".source-stamp.json");

// Why a source stamp instead of a dist byte-diff:
//
// Vite/Rollup output is not reproducible across the CI matrix — ubuntu, macos
// and windows each produce a different chunk hash (and differing bytes) from
// identical source. Diffing the built dist against the committed dist is
// therefore matrix-flaky, not a drift signal, which is why that check used to
// be `continue-on-error` (i.e. it gated nothing).
//
// The thing we actually need to catch is: someone changed UI source and forgot
// to repackage. That is answered deterministically by stamping the UI *inputs*
// (their git blob ids) at package time and re-deriving them at check time. No
// build required, identical on every runner, loud on real staleness.
const SOURCE_GLOB_DIRS = ["src", "public"];
const SOURCE_FILES = [
  "index.html",
  "package.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
];

const check = process.argv.includes("--check");

if (check) {
  await assertStampCurrent();
} else {
  await stat(source);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  await writeFile(
    stampPath,
    JSON.stringify({ sourceHash: await hashUiSources() }, null, 2) + "\n",
    "utf8",
  );
  console.log(
    `Packaged ${relative(root, source)} into ${relative(root, target)}.`,
  );
}

async function assertStampCurrent(): Promise<void> {
  const distFiles = await readFiles(target);
  if (distFiles.size === 0)
    throw new Error(
      "Packaged UI dist is missing — run `npm run build:ui && npm run package:ui`.",
    );

  let stamped: string | null = null;
  try {
    stamped = (
      JSON.parse(await readFile(stampPath, "utf8")) as { sourceHash?: string }
    ).sourceHash ?? null;
  } catch {
    stamped = null;
  }
  if (stamped === null)
    throw new Error(
      "Packaged UI dist has no source stamp — run `npm run build:ui && npm run package:ui`.",
    );

  const actual = await hashUiSources();
  if (actual !== stamped) {
    // Dump the per-file ids so a mismatch is diagnosable from the CI log
    // instead of needing a local repro on the same OS.
    console.error("UI source stamp inputs:");
    for (const row of await uiSourceRows()) console.error(`  ${row}`);
  }
  if (actual !== stamped)
    throw new Error(
      `Packaged UI dist is stale: apps/ui sources hash ${actual} but the committed dist was built from ${stamped}. ` +
        "Run `npm run build:ui && npm run package:ui` and commit the result.",
    );
  console.log("Packaged UI dist is current.");
}

/**
 * SHA-256 over the git blob ids of every UI source input.
 *
 * Blob ids are computed by git from the normalised (index) content, so they are
 * byte-identical on every platform regardless of checkout line-ending rules —
 * which a content hash of the working tree is not (observed: windows CI
 * disagreeing with ubuntu/macos on otherwise-identical source).
 */
async function hashUiSources(): Promise<string> {
  const hash = createHash("sha256");
  for (const row of await uiSourceRows()) hash.update(row + "\n");
  return hash.digest("hex");
}

async function uiSourceRows(): Promise<string[]> {
  const paths = [
    ...SOURCE_GLOB_DIRS.map((d) => `apps/ui/${d}`),
    ...SOURCE_FILES.map((f) => `apps/ui/${f}`),
  ];
  const git = (args: string[]): string => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (err) {
      throw new Error(
        `UI source stamp needs git ${args[0]}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const files = git(["ls-files", "--", ...paths])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
  if (files.length === 0)
    throw new Error("UI source stamp found no tracked apps/ui sources");

  // hash-object applies the same clean filters git would on commit, so the id
  // matches on every platform, and it reads the working tree — so packaging
  // before staging still stamps what you are about to commit.
  const ids = git(["hash-object", "--", ...files])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (ids.length !== files.length)
    throw new Error("UI source stamp: git hash-object returned a short list");
  return files.map((file, i) => `${file} ${ids[i]}`);
}

async function readFiles(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  try {
    await walk(directory, directory);
  } catch {
    return files;
  }
  return files;

  async function walk(current: string, base: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path, base);
      } else if (entry.isFile()) {
        const rel = relative(base, path).replaceAll("\\", "/");
        if (rel === ".source-stamp.json") continue;
        files.set(rel, await readFile(path));
      }
    }
  }
}
