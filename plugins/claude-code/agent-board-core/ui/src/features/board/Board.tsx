import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskDetailPanel } from './TaskDetailPanel';
import { CostBadge } from './CostBadge';
import { LanguageSelector } from './LanguageSelector';
import { ProjectSettingsDrawer } from './ProjectSettingsDrawer';

type Project = {
  id: string; code: string; name: string;
  description: string | null;
  workflow_type: 'WF1' | 'WF2';
  repo_path: string;
  auto_dispatch_pm: number;
  max_parallel: number;
  version: number;
};

const COLUMNS_WF1 = ['todo', 'agent_working', 'agent_review', 'human_approval', 'done'] as const;
const COLUMNS_WF2 = ['todo', 'agent_working', 'human_approval', 'done'] as const;

export function Board({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const tasks = useQuery({ queryKey: ['tasks'], queryFn: api.listTasks });
  const total = useQuery({
    queryKey: ['costs-total', project.code],
    queryFn: () => api.projectCostsTotal(project.code),
  });

  const cols = project.workflow_type === 'WF1' ? COLUMNS_WF1 : COLUMNS_WF2;
  const grouped = useMemo(() => {
    const g: Record<string, any[]> = Object.fromEntries(cols.map(c => [c, []]));
    for (const task of tasks.data?.tasks ?? []) {
      (g[task.status] ||= []).push(task);
    }
    return g;
  }, [tasks.data, cols]);

  return (
    <div className="board">
      <header>
        <div>
          <h1>{project.name} <span className="code">{project.code}</span></h1>
          <small className="muted">{project.workflow_type}</small>
        </div>
        <div className="header-actions">
          {total.data && (
            <div className="cost-header" title={`7d $${total.data.last_7d?.toFixed(4)} · 30d $${total.data.last_30d?.toFixed(4)}`}>
              {t('board.cost_total')}: ${total.data.all_time?.toFixed(4) ?? '0.0000'}
              {total.data.uncosted_runs > 0 && <span className="warn"> · {total.data.uncosted_runs} uncosted</span>}
            </div>
          )}
          <button onClick={() => setCreating(true)}>{t('board.new_task')}</button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('settings.open')}
            aria-label={t('settings.open')}
          >⚙</button>
          <LanguageSelector />
        </div>
      </header>

      <div className="columns">
        {cols.map(c => (
          <div key={c} className="column">
            <h2>{t(`board.${c}`)}<span className="count">{grouped[c]?.length ?? 0}</span></h2>
            <div className="cards">
              {(grouped[c] ?? []).map(task => (
                <TaskCard key={task.id} task={task} onClick={() => setSelected(task.code)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {creating && <CreateTaskModal onClose={() => setCreating(false)} />}
      {settingsOpen && (
        <ProjectSettingsDrawer project={project} onClose={() => setSettingsOpen(false)} />
      )}
      {selected && (
        <TaskDetailPanel
          taskCode={selected}
          workflow={project.workflow_type}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function TaskCard({ task, onClick }: { task: any; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="card" onClick={onClick}>
      <div className="card-top">
        <span className="code">{task.code}</span>
        {task.rework_count > 3 && <span className="stall-badge">{t('board.stalled')}</span>}
        <CostBadge taskCode={task.code} />
      </div>
      <div className="card-title">{task.title}</div>
      {task.assignee_role && <div className="assignee">@ {t(`role.${task.assignee_role}`)}</div>}
    </div>
  );
}
