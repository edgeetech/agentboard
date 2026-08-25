// Replaces the generic running spinner with a phase-aware pulse + last-event line.
// Reads server-side polled state (via api.activeStates) so cards never go silent
// even if SSE isn't connected.

import { useEffect, useState } from 'react';

import type { RunActiveState } from '../../api';

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11 }}>
      <PhaseBadge phase={state.phase} />
      {recent && (
        <span
          aria-hidden
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 0 0 rgba(16,185,129,0.8)',
            animation: 'agentboardPulse 1.4s ease-out infinite',
          }}
        />
      )}
      <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {state.last_kind ? `${KIND_LABEL[state.last_kind] ?? state.last_kind} · ${relTime(state.last_at)}` : ''}
      </span>
      {state.debt_count > 0 && (
        <span
          title={`${String(state.debt_count)} open debt items`}
          style={{
            background: '#fef2f2', color: '#b91c1c',
            padding: '1px 6px', borderRadius: 4, fontWeight: 600, fontSize: 10,
          }}
        >
          ⚠ {String(state.debt_count)}
        </span>
      )}
      <style>{`
        @keyframes agentboardPulse {
          0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.7); }
          70%  { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
          100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
        }
      `}</style>
    </div>
  );
}
