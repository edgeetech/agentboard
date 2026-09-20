import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "apps", "ui", "dist");
const target = join(
  root,
  "plugins",
  "claude-code",
  "agent-board-core",
  "ui",
  "dist",
);
// Vite/Rollup's per-file content hash is not stable across OS/Node toolchains:
// ubuntu, macos and windows each produce a different hash for byte-identical
// chunk content. A byte-exact comparison is therefore matrix-flaky rather than
// a real drift signal. We normalise the hash token out of both file names and
// file bodies, so the check still fails loudly on genuine content drift (the
// thing we care about) while staying deterministic on every runner.
const HASH_IN_NAME = /-[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9]+)$/;
const HASH_IN_BODY = /-[A-Za-z0-9_-]{8,}\.(js|css|mjs|map)/g;

const check = process.argv.includes("--check");

if (check) {
  await assertSameTree(source, target);
  console.log("Packaged UI dist is current.");
} else {
  await stat(source);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  console.log(
    `Packaged ${relative(root, source)} into ${relative(root, target)}.`,
  );
}

function normalizeName(path: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash + 1);
  const file = slash === -1 ? path : path.slice(slash + 1);
  return dir + file.replace(HASH_IN_NAME, "-HASH$1");
}

function normalizeBody(buf: Buffer): string {
  return buf.toString("utf8").replace(HASH_IN_BODY, "-HASH.$1");
}

async function assertSameTree(left: string, right: string): Promise<void> {
  const leftFiles = normalizeTree(await readFiles(left));
  const rightFiles = normalizeTree(await readFiles(right));
  const paths = new Set([...leftFiles.keys(), ...rightFiles.keys()]);

  for (const path of [...paths].sort()) {
    const leftFile = leftFiles.get(path);
    const rightFile = rightFiles.get(path);
    if (leftFile === undefined)
      throw new Error(`UI dist mismatch: ${path} missing from freshly built dist`);
    if (rightFile === undefined)
      throw new Error(`UI dist mismatch: ${path} missing from committed dist`);
    if (leftFile !== rightFile)
      throw new Error(
        `UI dist mismatch at ${path} — rebuild with \`npm run build:ui && npm run package:ui\``,
      );
  }
}

function normalizeTree(files: Map<string, Buffer>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, buf] of files) out.set(normalizeName(path), normalizeBody(buf));
  return out;
}

async function readFiles(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  await walk(directory, directory);
  return files;

  async function walk(current: string, base: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path, base);
      } else if (entry.isFile()) {
        files.set(
          relative(base, path).replaceAll("\\", "/"),
          await readFile(path),
        );
      }
    }
  }
}
