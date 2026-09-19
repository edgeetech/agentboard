import { useQuery } from '@tanstack/react-query';

import { api } from '../api';
import type { HealthSummary } from '../api';

export function HealthStrip({ projectCode }: { projectCode: string }) {
  const q = useQuery({
    queryKey: ['health-summary', projectCode],
    queryFn: () => api.projectHealthSummary(projectCode),
    refetchInterval: 15_000,
  });

  if (q.isLoading) return <div className="health-strip health-strip-loading" />;
  if (q.isError) {
    return (
      <div className="health-strip">
        <HealthItem label="Health" value="unavailable" tone="warn" />
      </div>
    );
  }
  const h = q.data;
  if (!h) return null;

  return (
    <div className="health-strip">
      <HealthItem label="Queue" value={`${h.queue.queued} queued / ${h.queue.running} running`} />
      <HealthItem label="Awaiting" value={String(h.queue.awaiting_human)} tone={h.queue.awaiting_human > 0 ? 'warn' : 'ok'} />
      <HealthItem label="Tracker" value={trackerLabel(h)} tone={trackerTone(h)} />
      <HealthItem label="Skills" value={h.skills?.status ?? 'not scanned'} tone={h.skills?.status === 'failed' ? 'bad' : 'ok'} />
      <HealthItem label="Cost" value={`$${(h.costs.all_time ?? 0).toFixed(4)}`} />
      <HealthItem label="Uncosted" value={String(h.costs.uncosted_runs)} tone={h.costs.uncosted_runs > 0 ? 'warn' : 'ok'} />
    </div>
  );
}

function trackerLabel(h: HealthSummary): string {
  if (!h.tracker.enabled) return 'disabled';
  if (!h.tracker.env_present) return 'missing env';
  if (h.tracker.rate_limited) return 'rate limited';
  if (h.tracker.last_error) return 'error';
  return `${h.tracker.issues_count} issue(s)`;
}

function trackerTone(h: HealthSummary): 'ok' | 'warn' | 'bad' {
  if (!h.tracker.enabled) return 'warn';
  if (!h.tracker.env_present || h.tracker.last_error) return 'bad';
  if (h.tracker.rate_limited) return 'warn';
  return 'ok';
}

function HealthItem({
  label,
  value,
  tone = 'ok',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className={`health-item health-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
