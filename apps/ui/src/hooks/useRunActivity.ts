// SSE hook for live agent activity. Subscribes to /api/runs/:id/events,
// reduces events into an ordered list, returns latest phase and event list.
// Falls back to one-shot fetch when EventSource is unavailable.

import { useEffect, useRef, useState } from 'react';

import type { ActivityEvent, Phase } from '../api';
import { api } from '../api';

interface State {
  events: ActivityEvent[];
  phase: Phase | null;
  lastKind: string | null;
  lastAt: string | null;
  connected: boolean;
}

const INITIAL: State = {
  events: [],
  phase: null,
  lastKind: null,
  lastAt: null,
  connected: false,
};

function reduce(state: State, evt: ActivityEvent): State {
  let phase: Phase | null = state.phase;
  if (evt.kind === 'phase:advanced') {
    const rawTo = (evt.payload as { to?: unknown }).to;
    const to = typeof rawTo === 'string' ? rawTo : '';
    if (to && to !== 'cancel' && to !== 'wontfix' && to !== 'revisit') {
      phase = to as Phase;
    } else if (to === 'revisit') {
      phase = 'DISCOVERY';
    }
  }
  return {
    events: [...state.events, evt],
    phase,
    lastKind: evt.kind,
    lastAt: evt.at,
    connected: state.connected,
  };
}

export function useRunActivity(runId: string | null | undefined): State {
  const [state, setState] = useState<State>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!runId) {
      setState(INITIAL);
      return;
    }
    setState(INITIAL);

    // SSE includes auth via cookie (server sets ab_token HttpOnly cookie on /).
    // EventSource doesn't accept custom headers, so we rely on the cookie path.
    const url = `/api/runs/${encodeURIComponent(runId)}/events`;
    let es: EventSource | null = null;
    let cancelled = false;

    try {
      es = new EventSource(url, { withCredentials: true });
    } catch {
      es = null;
    }

    if (es) {
      es.addEventListener('open', () => {
        if (cancelled) return;
        setState((s) => ({ ...s, connected: true }));
      });
      es.addEventListener('activity', (raw) => {
        if (cancelled) return;
        try {
          const data: unknown = (raw as MessageEvent<string>).data;
          if (typeof data !== 'string') return;
          const evt = JSON.parse(data) as ActivityEvent;
          setState((s) => reduce(s, evt));
        } catch {
          // ignore malformed event
        }
      });
      es.addEventListener('error', () => {
        if (cancelled) return;
        setState((s) => ({ ...s, connected: false }));
      });
    } else {
      // Fallback: one-shot fetch
      api
        .runActivity(runId)
        .then((r) => {
          if (cancelled) return;
          setState((s) => r.activity.reduce(reduce, s));
        })
        .catch(() => {
          /* ignore */
        });
    }

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [runId]);

  return state;
}
