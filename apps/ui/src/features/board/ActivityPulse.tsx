// Replaces the generic running spinner with a phase-aware pulse + last-event line.
// Reads server-side polled state (via api.activeStates) so cards never go silent
// even if SSE isn't connected.

import { useEffect, useState } from 'react';

import type { RunActiveState } from '../../api';
import { Icon } from '../../components/Icon';

import { PhaseBadge } from './PhaseBadge';

const KIND_LABEL: Record<string, string> = {
  'run:started': 'Started',
  'run:finished': 'Finished',
  'phase:advanced': 'Advanced phase',
  'phase:exit': 'Exited phase',
  'tool:invoked': 'Used tool',
  'tool:blocked': 'Tool blocked',
  'debt:recorded': 'Recorded debt',
  'debt:resolved': 'Resolved debt',
  'comment:posted': 'Commented',
  'ac:evidenced': 'AC evidenced',
};

function relTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 5_000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  return `${Math.floor(diff / 3_600_000)}h`;
}

export function ActivityPulse({ state }: { state: RunActiveState | null | undefined }) {
  const [, setTick] = useState(0);
  // Re-render every 5s for relative time.
  useEffect(() => {
    const id = setInterval(() => { setTick((n) => n + 1); }, 5000);
    return () => { clearInterval(id); };
  }, []);

  if (!state?.phase || state.run_status !== 'running') return null;

  const recent =
    state.last_at !== null &&
    state.last_at !== '' &&
    Date.now() - new Date(state.last_at).getTime() < 5000;

  return (
    <div className="activity-pulse">
      <PhaseBadge phase={state.phase} />
      {recent && <span className="activity-pulse-dot" aria-hidden />}
      <span className="activity-pulse-label">
        {state.last_kind ? `${KIND_LABEL[state.last_kind] ?? state.last_kind} · ${relTime(state.last_at)}` : ''}
      </span>
      {state.debt_count > 0 && (
        <span className="activity-pulse-debt" title={`${String(state.debt_count)} open debt items`}>
          <Icon name="alert-triangle" size={11} /> {String(state.debt_count)}
        </span>
      )}
    </div>
  );
}
