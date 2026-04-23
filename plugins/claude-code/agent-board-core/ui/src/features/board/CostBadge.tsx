import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function CostBadge({ taskCode }: { taskCode: string }) {
  const q = useQuery({
    queryKey: ['task-cost', taskCode],
    queryFn: () => api.taskCost(taskCode),
    refetchInterval: 10_000,
  });
  const c = q.data?.cost_usd;
  if (c == null) return null;
  const tip = (q.data?.by_role || []).map((r: any) => `${r.role}: ${fmt.format(r.cost_usd)}`).join(' · ');
  return <span className="cost-chip" title={tip}>{fmt.format(c)}</span>;
}
