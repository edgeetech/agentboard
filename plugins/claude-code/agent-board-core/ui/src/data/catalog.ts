/**
 * Local catalog for Roles.
 *
 * Skills moved to server-backed scan in v0.2 — see /api/skills.
 * Roles remain local (browser-only) until the server adds a roles table.
 */

export interface Role {
  id: string;
  name: string;
  emblem: string;
  description: string;
  skills: string[];
}

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

const KEY_ROLES = 'ab.catalog.roles';

function load<T extends { id: string }>(key: string, defaults: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const overrides = JSON.parse(raw) as Record<string, T>;
    const merged = defaults.map(d => (overrides[d.id] ? overrides[d.id] : d));
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

export function loadRoles(): Role[] { return load(KEY_ROLES, ROLES_DEFAULT); }
export function saveRoles(items: Role[]) { save(KEY_ROLES, items); }
export function getRole(id: string): Role | undefined { return loadRoles().find(r => r.id === id); }
export function upsertRole(role: Role) {
  const items = loadRoles();
  const i = items.findIndex(r => r.id === role.id);
  if (i >= 0) items[i] = role; else items.push(role);
  saveRoles(items);
}
