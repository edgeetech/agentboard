import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { api } from '../api';
import type { HealthSummary } from '../api';

export function HealthStrip({ projectCode }: { projectCode: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['health-summary', projectCode],
    queryFn: () => api.projectHealthSummary(projectCode),
    refetchInterval: 15_000,
  });

  if (q.isLoading) return <div className="health-strip health-strip-loading" />;
  if (q.isError) {
    return (
      <div className="health-strip">
        <HealthItem label={t('health.health', 'Health')} value={t('health.unavailable', 'unavailable')} tone="warn" />
      </div>
    );
  }
  const h = q.data;
  if (!h) return null;

  return (
    <div className="health-strip">
      <HealthItem label={t('health.queue', 'Queue')} value={t('health.queue_value', '{{queued}} queued / {{running}} running', { queued: h.queue.queued, running: h.queue.running })} />
      <HealthItem label={t('health.awaiting', 'Awaiting')} value={String(h.queue.awaiting_human)} tone={h.queue.awaiting_human > 0 ? 'warn' : 'ok'} />
      <HealthItem label={t('health.tracker', 'Tracker')} value={trackerLabel(h, t)} tone={trackerTone(h)} />
      <HealthItem label={t('health.skills', 'Skills')} value={h.skills?.status ?? t('health.not_scanned', 'not scanned')} tone={h.skills?.status === 'failed' ? 'bad' : 'ok'} />
      <HealthItem label={t('health.cost', 'Cost')} value={`$${(h.costs.all_time ?? 0).toFixed(4)}`} />
      <HealthItem label={t('health.uncosted', 'Uncosted')} value={String(h.costs.uncosted_runs)} tone={h.costs.uncosted_runs > 0 ? 'warn' : 'ok'} />
    </div>
  );
}

function trackerLabel(h: HealthSummary, t: TFunction): string {
  if (!h.tracker.enabled) return t('health.tracker_disabled', 'disabled');
  if (!h.tracker.env_present) return t('health.tracker_missing_env', 'missing env');
  if (h.tracker.rate_limited) return t('health.tracker_rate_limited', 'rate limited');
  if (h.tracker.last_error) return t('health.tracker_error', 'error');
  return t('health.tracker_issue_count', '{{count}} issue(s)', { count: h.tracker.issues_count });
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
