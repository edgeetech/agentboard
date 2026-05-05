// Phase + activity timeline for the task detail panel. Subscribes to SSE for
// the most recent run on the task and shows a live event log.

import { useTranslation } from 'react-i18next';

import type { ActivityEvent } from '../../api';
import { useRunActivity } from '../../hooks/useRunActivity';

import { PhaseBadge } from './PhaseBadge';

interface Props {
  runId: string | null;
}

const KIND_VERB: Record<string, string> = {
  'run:started': 'started',
  'run:finished': 'finished',
  'phase:advanced': 'advanced to',
  'phase:exit': 'exited',
  'tool:invoked': 'used',
  'tool:blocked': 'blocked',
  'debt:recorded': 'recorded debt',
  'debt:resolved': 'resolved debt',
  'comment:posted': 'commented',
  'ac:evidenced': 'evidenced AC',
};

function s(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function describe(evt: ActivityEvent): string {
  const verb = KIND_VERB[evt.kind] ?? evt.kind;
  const p = evt.payload;
  if (evt.kind === 'phase:advanced') return `${verb} ${s(p.to)}`;
  if (evt.kind === 'phase:exit') return `${verb} via ${s(p.verb)}`;
  if (evt.kind === 'tool:invoked') {
    const target = s(p.target);
    return `${verb} ${s(p.tool)}${target ? ` (${target.slice(0, 60)})` : ''}`;
  }
  if (evt.kind === 'tool:blocked') return `${verb} ${s(p.tool)}: ${s(p.reason)}`;
  if (evt.kind === 'debt:recorded') return `${verb}: ${s(p.description)}`;
  if (evt.kind === 'run:started') return `${verb} (${s(p.role)}, ${s(p.mode)})`;
  if (evt.kind === 'run:finished') return `${verb} ${s(p.status)}`;
  return verb;
}

export function PhaseTimeline({ runId }: Props) {
  const { t } = useTranslation();
  const { events, phase, connected } = useRunActivity(runId);

  if (!runId) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280' }}>{t('phase.label', 'Phase')}</strong>
        <PhaseBadge phase={phase} size="md" />
        <span style={{ marginLeft: 'auto', fontSize: 10, color: connected ? '#10b981' : '#9ca3af' }}>
          {connected ? t('phase.live', '● live') : t('phase.replay', '○ replay')}
        </span>
      </div>
      <ol
        style={{
          listStyle: 'none', padding: 0, margin: 0,
          maxHeight: 240, overflowY: 'auto',
          border: '1px solid #e5e7eb', borderRadius: 4,
          background: '#fafafa',
        }}
      >
        {events.length === 0 && (
          <li style={{ padding: 8, fontSize: 12, color: '#9ca3af' }}>{t('phase.no_activity', 'No activity yet.')}</li>
        )}
        {events.map((e) => (
          <li
            key={e.id}
            style={{
              padding: '6px 10px',
              borderBottom: '1px solid #f3f4f6',
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              display: 'flex', gap: 8, alignItems: 'baseline',
            }}
          >
            <span style={{ color: '#9ca3af', flexShrink: 0 }}>{e.at.slice(11, 19)}</span>
            <span style={{ color: '#374151' }}>{describe(e)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
