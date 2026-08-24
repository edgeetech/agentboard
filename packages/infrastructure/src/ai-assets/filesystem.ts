import {
  normalizeAiAsset,
  type AiAsset,
  type AiAssetSource,
} from "../../../engine/src/index.ts";

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
