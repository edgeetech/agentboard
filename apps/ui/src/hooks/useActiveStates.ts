// Polled batch query for per-task run/phase state. React Query dedupes by
// queryKey, so multiple components calling this share one network request.

import { useQuery } from '@tanstack/react-query';

import type { RunActiveState } from '../api';
import { api } from '../api';

const REFETCH_MS = 5000;

export function useActiveStates() {
  return useQuery({
    queryKey: ['active-states'],
    queryFn: () => api.activeStates(),
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
    staleTime: 1000,
  });
}

export function useTaskActiveState(taskId: string | null | undefined): RunActiveState | null {
  const { data } = useActiveStates();
  if (!taskId || !data) return null;
  return data.states[taskId] ?? null;
}
