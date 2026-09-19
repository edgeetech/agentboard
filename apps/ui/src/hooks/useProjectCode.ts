import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { setProjectCode, getProjectCode } from '../api';

import { rememberLastProject } from './useCurrentProjectCode';

/**
 * Sync the URL `:projectCode` param with the api module's per-tab projectCode.
 * Mount inside any project-scoped route.
 *
 * setProjectCode() is called SYNCHRONOUSLY during render (not just useEffect)
 * so child components making API calls in their first render read the correct
 * value — effects fire after commit and would otherwise race.
 */
export function useProjectCode(): string | null {
  const { projectCode } = useParams<{ projectCode: string }>();
  const qc = useQueryClient();
  const upper = projectCode ? projectCode.toUpperCase() : null;

  // Synchronous, idempotent. Side effect in render body is OK here because
  // we're setting a module-level variable, not scheduling React state updates.
  if (getProjectCode() !== upper) setProjectCode(upper);
  // Remember last-viewed project so non-project routes can resolve back to it.
  if (upper) rememberLastProject(upper);

  useEffect(() => {
    // On change, drop any cached queries that are project-scoped.
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task'] });
    qc.invalidateQueries({ queryKey: ['board'] });
  }, [upper, qc]);

  return upper;
}
