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

async function assertSameTree(left: string, right: string): Promise<void> {
  const leftFiles = await readFiles(left);
  const rightFiles = await readFiles(right);
  const paths = new Set([...leftFiles.keys(), ...rightFiles.keys()]);

  for (const path of [...paths].sort()) {
    const leftFile = leftFiles.get(path);
    const rightFile = rightFiles.get(path);
    if (
      leftFile === undefined ||
      rightFile === undefined ||
      !leftFile.equals(rightFile)
    ) {
      throw new Error(`UI dist mismatch at ${path}`);
    }
  }
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
