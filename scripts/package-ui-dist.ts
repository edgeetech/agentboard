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
// to repackage. That is answered deterministically by hashing the UI *inputs*
// at package time and re-hashing them at check time. No build required, stable
// on every runner, and it fails loudly on real staleness.
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
  if (actual !== stamped)
    throw new Error(
      `Packaged UI dist is stale: apps/ui sources hash ${actual} but the committed dist was built from ${stamped}. ` +
        "Run `npm run build:ui && npm run package:ui` and commit the result.",
    );
  console.log("Packaged UI dist is current.");
}

/** SHA-256 over every UI source input, path-sorted and newline-normalised. */
async function hashUiSources(): Promise<string> {
  const entries: [string, Buffer][] = [];
  for (const dir of SOURCE_GLOB_DIRS) {
    const abs = join(uiRoot, dir);
    try {
      await stat(abs);
    } catch {
      continue;
    }
    for (const [path, buf] of await readFiles(abs))
      entries.push([`${dir}/${path}`, buf]);
  }
  for (const file of SOURCE_FILES) {
    try {
      entries.push([file, await readFile(join(uiRoot, file))]);
    } catch {
      /* optional file */
    }
  }

  const hash = createHash("sha256");
  for (const [path, buf] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
    hash.update(path);
    hash.update("\0");
    // Normalise CRLF so a Windows checkout and a Linux checkout agree.
    hash.update(buf.toString("utf8").replaceAll("\r\n", "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
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
