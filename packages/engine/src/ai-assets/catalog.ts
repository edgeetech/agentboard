import type { Phase, RunRole } from "../domain/types.ts";
import { parseMarkdownAsset } from "./markdown.ts";

export type AiAssetKind = "role" | "persona" | "skill" | "concern" | "phase" | "fragment";

export interface AiAssetSource {
  readonly kind: AiAssetKind;
  readonly id: string;
  readonly path: string;
  readonly content: string;
}

export interface RoleAsset {
  readonly kind: "role";
  readonly id: string;
  readonly role: RunRole;
  readonly title: string;
  readonly body: string;
  readonly path: string;
}

export interface SkillAsset {
  readonly kind: "skill";
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly emblem: string;
  readonly tags: readonly string[];
  readonly allowedTools: readonly string[];
  readonly body: string;
  readonly path: string;
}

export interface ConcernAsset {
  readonly kind: "concern";
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly phases: Partial<Record<Phase, ConcernPhaseAsset>>;
  readonly path: string;
}

export interface ConcernPhaseAsset {
  readonly reminders: readonly string[];
  readonly reviewDimensions: readonly string[];
}

export type AiAsset = RoleAsset | SkillAsset | ConcernAsset;

export function normalizeAiAsset(source: AiAssetSource): AiAsset {
  switch (source.kind) {
    case "role":
      return normalizeRoleAsset(source);
    case "skill":
      return normalizeSkillAsset(source);
    case "concern":
      return normalizeConcernAsset(source);
    default:
      throw new Error(`Unsupported AI asset kind: ${source.kind}`);
  }
}

function normalizeRoleAsset(source: AiAssetSource): RoleAsset {
  const parsed = parseMarkdownAsset(source.content);
  const role = stringField(parsed.frontmatter, "role", source.id);
  if (!isRunRole(role)) throw new Error(`Invalid role asset '${source.id}': unsupported role ${role}`);
  return {
    kind: "role",
    id: source.id,
    role,
    title: stringField(parsed.frontmatter, "title", role),
    body: parsed.body,
    path: source.path,
  };
}

function normalizeSkillAsset(source: AiAssetSource): SkillAsset {
  const parsed = parseMarkdownAsset(source.content);
  const name = stringField(parsed.frontmatter, "name", source.id);
  return {
    kind: "skill",
    id: source.id,
    name,
    description: stringField(parsed.frontmatter, "description", ""),
    emblem: stringField(parsed.frontmatter, "emblem", deriveEmblem(name)),
    tags: arrayField(parsed.frontmatter, "tags"),
    allowedTools: arrayField(parsed.frontmatter, "allowed-tools"),
    body: parsed.body,
    path: source.path,
  };
}

function normalizeConcernAsset(source: AiAssetSource): ConcernAsset {
  const parsed = parseMarkdownAsset(source.content);
  return {
    kind: "concern",
    id: source.id,
    title: stringField(parsed.frontmatter, "title", source.id),
    description: stringField(parsed.frontmatter, "description", ""),
    phases: parseConcernPhases(parsed.body),
    path: source.path,
  };
}

function parseConcernPhases(body: string): Partial<Record<Phase, ConcernPhaseAsset>> {
  const phases: Partial<Record<Phase, ConcernPhaseAsset>> = {};
  let current: Phase | null = null;
  let section: "reminders" | "reviewDimensions" | null = null;

  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^##\s+([A-Z_ -]+)\s*$/.exec(line);
    if (heading) {
      const phase = (heading[1] ?? "").trim().replaceAll(" ", "_");
      current = isPhase(phase) ? phase : null;
      section = null;
      if (current !== null && phases[current] === undefined) {
        phases[current] = { reminders: [], reviewDimensions: [] };
      }
      continue;
    }

    if (/^###\s+Reminders\s*$/i.test(line)) {
      section = "reminders";
      continue;
    }
    if (/^###\s+Review Dimensions\s*$/i.test(line)) {
      section = "reviewDimensions";
      continue;
    }

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (current !== null && section !== null && item) {
      const existing = phases[current] ?? { reminders: [], reviewDimensions: [] };
      phases[current] = {
        reminders:
          section === "reminders"
            ? [...existing.reminders, item[1] ?? ""]
            : existing.reminders,
        reviewDimensions:
          section === "reviewDimensions"
            ? [...existing.reviewDimensions, item[1] ?? ""]
            : existing.reviewDimensions,
      };
    }
  }

  return phases;
}

function stringField(
  frontmatter: Readonly<Record<string, string | readonly string[]>>,
  key: string,
  fallback: string,
): string {
  const value = frontmatter[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function arrayField(
  frontmatter: Readonly<Record<string, string | readonly string[]>>,
  key: string,
): readonly string[] {
  const value = frontmatter[key];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function isRunRole(value: string): value is RunRole {
  return value === "pm" || value === "worker" || value === "reviewer";
}

function isPhase(value: string): value is Phase {
  return (
    value === "DISCOVERY" ||
    value === "REFINEMENT" ||
    value === "PLANNING" ||
    value === "EXECUTING" ||
    value === "VERIFICATION" ||
    value === "DONE"
  );
}

function deriveEmblem(name: string): string {
  const cleaned = name.replaceAll(/[^A-Za-z0-9]/g, "");
  return (cleaned.length > 0 ? cleaned : name).slice(0, 3).toUpperCase();
}
