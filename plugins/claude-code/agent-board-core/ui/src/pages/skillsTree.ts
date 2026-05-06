export interface SkillTreeSkill {
  id: string;
  name: string;
  description: string;
  emblem: string;
  tags: string[];
  relDir: string;
  relPath: string;
  layout: 'folder' | 'file';
  allowedTools: string[];
  scannedAt: string;
}

export interface SkillTreeBranchNode {
  kind: 'branch';
  id: string;
  label: string;
  path: string;
  children: SkillTreeNode[];
  skillCount: number;
}

export interface SkillTreeLeafNode {
  kind: 'leaf';
  id: string;
  label: string;
  path: string;
  skill: SkillTreeSkill;
}

export type SkillTreeNode = SkillTreeBranchNode | SkillTreeLeafNode;

interface BuildSegmentsResult {
  root: string;
  branches: string[];
  leafPath: string;
}

interface MutableBranch {
  kind: 'branch';
  id: string;
  label: string;
  path: string;
  skillCount: number;
  children: Map<string, MutableBranch | SkillTreeLeafNode>;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

function compareLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function toSegments(skill: SkillTreeSkill): BuildSegmentsResult {
  if (skill.id.startsWith('builtin:')) {
    const relPath = normalizePath(skill.relPath);
    const root = 'builtin';
    const withoutRoot = relPath.startsWith('builtin/') ? relPath.slice('builtin/'.length) : relPath;
    const parts = withoutRoot.split('/').filter(Boolean);
    const leafPath = parts.join('/') || skill.name;
    return {
      root,
      branches: parts.slice(0, -1),
      leafPath,
    };
  }

  const relDir = normalizePath(skill.relDir);
  const relPath = normalizePath(skill.relPath);
  const dirPrefix = relDir ? `${relDir}/` : '';
  const remainder = relPath.startsWith(dirPrefix) ? relPath.slice(dirPrefix.length) : relPath;
  const parts = remainder.split('/').filter(Boolean);
  const finalParts =
    skill.layout === 'folder' && parts.at(-1) === 'SKILL.md'
      ? parts.slice(0, -1)
      : parts;
  const leafPath = finalParts.join('/') || skill.name;
  return {
    root: relDir || '.',
    branches: finalParts.slice(0, -1),
    leafPath,
  };
}

function createBranch(id: string, label: string, path: string): MutableBranch {
  return {
    kind: 'branch',
    id,
    label,
    path,
    skillCount: 0,
    children: new Map<string, MutableBranch | SkillTreeLeafNode>(),
  };
}

function freezeBranch(branch: MutableBranch): SkillTreeBranchNode {
  const children = [...branch.children.values()]
    .map((child) => (child.kind === 'branch' ? freezeBranch(child) : child))
    .toSorted((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'branch' ? -1 : 1;
      if (a.kind === 'branch' && b.kind === 'branch') return compareLabel(a.label, b.label);
      return compareLabel(a.label, b.label);
    });
  const skillCount = children.reduce(
    (count, child) => count + (child.kind === 'branch' ? child.skillCount : 1),
    0,
  );
  return {
    kind: 'branch',
    id: branch.id,
    label: branch.label,
    path: branch.path,
    children,
    skillCount,
  };
}

export function buildSkillsTree(skills: SkillTreeSkill[]): SkillTreeBranchNode[] {
  const roots = new Map<string, MutableBranch>();

  for (const skill of skills) {
    const { root, branches, leafPath } = toSegments(skill);
    const rootId = `branch:${root}`;
    let branch = roots.get(rootId);
    if (!branch) {
      branch = createBranch(rootId, root, root);
      roots.set(rootId, branch);
    }

    let current = branch;
    const branchPath: string[] = [];
    for (const segment of branches) {
      branchPath.push(segment);
      const branchId = `branch:${root}/${branchPath.join('/')}`;
      const existing = current.children.get(branchId);
      if (existing?.kind === 'branch') {
        current = existing;
        continue;
      }
      const next = createBranch(branchId, segment, `${root}/${branchPath.join('/')}`);
      current.children.set(branchId, next);
      current = next;
    }

    current.children.set(`leaf:${skill.id}`, {
      kind: 'leaf',
      id: `leaf:${skill.id}`,
      label: skill.name,
      path: leafPath,
      skill,
    });
  }

  return [...roots.values()]
    .map((branch) => freezeBranch(branch))
    .toSorted((a, b) => compareLabel(a.label, b.label));
}

export function collectExpandedBranchIds(nodes: readonly SkillTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (items: readonly SkillTreeNode[]) => {
    for (const item of items) {
      if (item.kind !== 'branch') continue;
      ids.add(item.id);
      visit(item.children);
    }
  };
  visit(nodes);
  return ids;
}
