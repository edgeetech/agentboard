/**
 * Local catalog for Skills + Roles.
 *
 * Not backed by the server yet — edits are persisted in localStorage so they
 * survive a reload, but each browser has its own copy. When the agentboard
 * server gains skill/role tables, swap this module for API-backed state.
 */

export type Skill = {
  id: string;
  name: string;
  emblem: string;
  description: string;
  tags: string[];
};

export type Role = {
  id: string;
  name: string;
  emblem: string;
  description: string;
  skills: string[];
};

const SKILLS_DEFAULT: Skill[] = [
  { id: 'code-review', name: 'Code Review', emblem: 'CR',
    description: 'Inspect a diff against coding standards, flag bugs, suggest fixes inline.',
    tags: ['reviewer', 'default'] },
  { id: 'unit-tests', name: 'Unit Tests', emblem: 'UT',
    description: 'Generate / update unit tests so new behaviour is covered and regressions guarded.',
    tags: ['worker', 'jest', 'pytest'] },
  { id: 'tech-spec', name: 'Tech Spec Drafting', emblem: 'TS',
    description: 'Turn a loose description into acceptance criteria, risks, and a work breakdown.',
    tags: ['pm', 'default'] },
  { id: 'refactor', name: 'Refactor', emblem: 'RF',
    description: 'Rework an existing module for clarity, reuse, or performance without changing behaviour.',
    tags: ['worker'] },
  { id: 'api-client', name: 'API Client', emblem: 'AC',
    description: 'Wire a typed API client to a remote service, including retry and error handling.',
    tags: ['worker', 'typescript'] },
  { id: 'release-notes', name: 'Release Notes', emblem: 'RN',
    description: 'Summarise merged PRs into concise release notes grouped by scope and impact.',
    tags: ['reviewer'] },
];

const ROLES_DEFAULT: Role[] = [
  { id: 'pm', name: 'PM', emblem: 'PM',
    description: 'Enriches the task: writes description, acceptance criteria, breaks scope.',
    skills: ['tech-spec', 'triage'] },
  { id: 'worker', name: 'Worker', emblem: 'WK',
    description: 'Implements the change end-to-end: edits code, runs tests, commits.',
    skills: ['unit-tests', 'refactor', 'api-client'] },
  { id: 'reviewer', name: 'Reviewer', emblem: 'RV',
    description: 'Reviews the diff, raises issues, asks for rework or hands back for human approval.',
    skills: ['code-review', 'release-notes'] },
  { id: 'human', name: 'Human', emblem: 'HU',
    description: 'You. Approves done work or rejects back to the worker with a comment.',
    skills: ['approve', 'reject'] },
];

const KEY_SKILLS = 'ab.catalog.skills';
const KEY_ROLES = 'ab.catalog.roles';

function load<T extends { id: string }>(key: string, defaults: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const overrides = JSON.parse(raw) as Record<string, T>;
    const merged = defaults.map(d => (overrides[d.id] ? overrides[d.id] : d));
    // Include any user-added entries not in defaults
    for (const id of Object.keys(overrides)) {
      if (!merged.some(m => m.id === id)) merged.push(overrides[id]);
    }
    return merged;
  } catch { return defaults; }
}

function save<T extends { id: string }>(key: string, items: T[]) {
  try {
    const map: Record<string, T> = {};
    for (const it of items) map[it.id] = it;
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

export function loadSkills(): Skill[] { return load(KEY_SKILLS, SKILLS_DEFAULT); }
export function saveSkills(items: Skill[]) { save(KEY_SKILLS, items); }
export function getSkill(id: string): Skill | undefined { return loadSkills().find(s => s.id === id); }
export function upsertSkill(skill: Skill) {
  const items = loadSkills();
  const i = items.findIndex(s => s.id === skill.id);
  if (i >= 0) items[i] = skill; else items.push(skill);
  saveSkills(items);
}

export function loadRoles(): Role[] { return load(KEY_ROLES, ROLES_DEFAULT); }
export function saveRoles(items: Role[]) { save(KEY_ROLES, items); }
export function getRole(id: string): Role | undefined { return loadRoles().find(r => r.id === id); }
export function upsertRole(role: Role) {
  const items = loadRoles();
  const i = items.findIndex(r => r.id === role.id);
  if (i >= 0) items[i] = role; else items.push(role);
  saveRoles(items);
}
