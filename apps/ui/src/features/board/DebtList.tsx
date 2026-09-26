// Open carryforward debt list for the task detail panel. Reads from the
// activity feed (debt:recorded / debt:resolved) — no separate endpoint needed
// because the activity log is the source of truth.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActivityEvent } from '../../api';
import { Icon } from '../../components/Icon';
import { useRunActivity } from '../../hooks/useRunActivity';

interface DebtRow {
  id: string;
  description: string;
  recordedAt: string;
  resolved: boolean;
}

function s(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function reduceDebt(events: ActivityEvent[]): DebtRow[] {
  const map = new Map<string, DebtRow>();
  for (const e of events) {
    const p = e.payload;
    if (e.kind === 'debt:recorded') {
      const id = s(p.id);
      if (!id) continue;
      map.set(id, {
        id,
        description: s(p.description),
        recordedAt: e.at,
        resolved: false,
      });
    } else if (e.kind === 'debt:resolved') {
      const id = s(p.id);
      const existing = map.get(id);
      if (existing) existing.resolved = true;
    }
  }
  return [...map.values()].filter((d) => !d.resolved);
}

export function DebtList({ runId }: { runId: string | null }) {
  const { t } = useTranslation();
  const { events } = useRunActivity(runId);
  const open = useMemo(() => reduceDebt(events), [events]);

  if (!runId) return null;
  if (open.length === 0) return null;

  return (
    <div className="debt-list">
      <strong className="debt-list-title">
        {t('phase.debt', 'Debt')} ({open.length})
      </strong>
      <ul className="debt-list-items">
        {open.map((d) => (
          <li key={d.id} className="debt-list-item">
            <Icon name="alert-triangle" size={12} /> {d.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
