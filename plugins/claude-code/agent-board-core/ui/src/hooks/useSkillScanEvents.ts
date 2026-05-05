// SSE hook for skill scan lifecycle. Subscribes to /api/skills/scan/events
// and forwards each event to the caller. Auth via HttpOnly cookie (same as
// useRunActivity); EventSource cannot send custom headers.

import { useEffect, useState } from 'react';

import type { ApiScan, SkillScanEvent } from '../api';

interface State {
  connected: boolean;
}

export function useSkillScanEvents(
  projectCode: string | null,
  onEvent: (e: SkillScanEvent) => void,
): State {
  const [state, setState] = useState<State>({ connected: false });

  useEffect(() => {
    if (!projectCode) {
      setState({ connected: false });
      return;
    }
    let es: EventSource | null = null;
    let cancelled = false;

    try {
      es = new EventSource('/api/skills/scan/events', { withCredentials: true });
    } catch {
      es = null;
    }

    if (!es) return;

    es.addEventListener('open', () => {
      if (cancelled) return;
      setState({ connected: true });
    });

    const handler = (kind: SkillScanEvent['type']) => (raw: Event) => {
      if (cancelled) return;
      try {
        const data: unknown = (raw as MessageEvent<string>).data;
        if (typeof data !== 'string') return;
        const parsed: unknown = JSON.parse(data);
        const scan: ApiScan | null =
          typeof parsed === 'object' && parsed !== null && 'id' in parsed
            ? (parsed as ApiScan)
            : null;
        onEvent({ type: kind, scan });
      } catch {
        // ignore malformed event
      }
    };

    es.addEventListener('skill-scan:started', handler('skill-scan:started'));
    es.addEventListener('skill-scan:finished', handler('skill-scan:finished'));
    es.addEventListener('skill-scan:latest', handler('skill-scan:latest'));

    es.addEventListener('error', () => {
      if (cancelled) return;
      setState({ connected: false });
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, [projectCode, onEvent]);

  return state;
}
