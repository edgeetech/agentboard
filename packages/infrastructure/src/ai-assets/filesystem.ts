import {
  normalizeAiAsset,
  type AiAsset,
  type AiAssetSource,
} from "../../../engine/src/index.ts";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export interface AiAssetDirectoryEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
}

export interface AiAssetFilesystemPort {
  list(path: string): readonly AiAssetDirectoryEntry[];
  readText(path: string): string;
}

export interface LoadBuiltInAiAssetsOptions {
  readonly rootPath: string;
}

export interface NodeAiAssetFilesystemOptions {
  readonly rootDir: string;
}

export function createNodeAiAssetFilesystem(
  options: NodeAiAssetFilesystemOptions,
): AiAssetFilesystemPort {
  return new NodeAiAssetFilesystem(options.rootDir);
}

export function loadBuiltInAiAssets(
  fs: AiAssetFilesystemPort,
  options: LoadBuiltInAiAssetsOptions,
): readonly AiAsset[] {
  const sources = [
    ...loadSkillSources(fs, options.rootPath),
    ...loadConcernSources(fs, options.rootPath),
  ];
  assertUniqueIds(sources);
  return sources.map(normalizeAiAsset);
}

function loadSkillSources(
  fs: AiAssetFilesystemPort,
  rootPath: string,
): AiAssetSource[] {
  const skillsPath = joinPath(rootPath, "skills");
  return fs
    .list(skillsPath)
    .filter((entry) => entry.kind === "directory")
    .sort(compareEntryName)
    .map((entry) => {
      const path = joinPath(skillsPath, entry.name, "SKILL.md");
      return {
        kind: "skill",
        id: entry.name,
        path,
        content: fs.readText(path),
      };
    });
}

function loadConcernSources(
  fs: AiAssetFilesystemPort,
  rootPath: string,
): AiAssetSource[] {
  const concernsPath = joinPath(rootPath, "concerns");
  return fs
    .list(concernsPath)
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".md"))
    .sort(compareEntryName)
    .map((entry) => {
      const id = entry.name.slice(0, -".md".length);
      const path = joinPath(concernsPath, entry.name);
      return {
        kind: "concern",
        id,
        path,
        content: fs.readText(path),
      };
    });
}

function assertUniqueIds(sources: readonly AiAssetSource[]): void {
  const seen = new Map<string, string>();
  for (const source of sources) {
    const key = `${source.kind}:${source.id}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      throw new Error(
        `Duplicate built-in AI asset ${key} at ${existing} and ${source.path}`,
      );
    }
    seen.set(key, source.path);
  }
}

function compareEntryName(
  a: AiAssetDirectoryEntry,
  b: AiAssetDirectoryEntry,
): number {
  return a.name.localeCompare(b.name);
}

function joinPath(...parts: readonly string[]): string {
  return parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter((part) => part.length > 0)
    .join("/");
}

class NodeAiAssetFilesystem implements AiAssetFilesystemPort {
  readonly #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = resolve(rootDir);
  }

  list(path: string): readonly AiAssetDirectoryEntry[] {
    const absPath = this.#resolve(path);
    try {
      return readdirSync(absPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map(
          (entry): AiAssetDirectoryEntry => ({
            name: entry.name,
            kind: entry.isDirectory() ? "directory" : "file",
          }),
        )
        .sort(compareEntryName);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw error;
    }
  }

  readText(path: string): string {
    return readFileSync(this.#resolve(path), "utf8");
  }

  #resolve(path: string): string {
    const absPath = resolve(this.#rootDir, path);
    const relPath = relative(this.#rootDir, absPath);
    if (relPath.startsWith("..") || isAbsolute(relPath)) {
      throw new Error(`AI asset path escapes root: ${path}`);
    }
    return absPath;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
