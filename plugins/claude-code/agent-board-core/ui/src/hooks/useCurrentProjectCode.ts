import { useMatch } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const LAST_KEY = 'agentboard.lastProject';

/** Store last-viewed project code. Consulted when the current URL has no
 *  `:projectCode` (e.g. Skills, Sessions, Theme) so Board/Project nav links
 *  go back to whatever project the user was on, not always the first one. */
export function rememberLastProject(code: string | null) {
  try {
    if (code) localStorage.setItem(LAST_KEY, code);
    else localStorage.removeItem(LAST_KEY);
  } catch {}
}
export function recallLastProject(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

/**
 * Resolve the effective "current project" for a React component, regardless
 * of whether we're on a project-scoped route. Order of preference:
 *   1. URL `:projectCode` (authoritative when present)
 *   2. localStorage last-viewed project
 *   3. First project in the list
 *   4. null (nothing created yet)
 * Returns the project object (from the cached projects list) or null.
 */
export function useCurrentProject() {
  const nestedMatch = useMatch('/projects/:projectCode/*');
  const leafMatch = useMatch('/projects/:projectCode');
  const urlCode = (nestedMatch?.params?.projectCode || leafMatch?.params?.projectCode)?.toUpperCase() || null;

  const { data } = useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects });
  const projects: Array<any> = data?.projects || [];

  const resolvedCode = urlCode
    || (recallLastProject() ? recallLastProject()!.toUpperCase() : null)
    || projects[0]?.code
    || null;

  const project = resolvedCode
    ? (projects.find(p => p.code === resolvedCode) || null)
    : null;

  return { project, urlCode };
}
