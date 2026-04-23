import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
} from '@dnd-kit/core';
import { api } from '../../api';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskDetailPanel } from './TaskDetailPanel';
import { CostBadge } from './CostBadge';
import { useCardView } from '../../hooks/useCardView';
import type { CardView as CardViewMode } from '../../hooks/useCardView';

type Project = {
  id: string; code: string; name: string;
  description: string | null;
  workflow_type: 'WF1' | 'WF2';
  repo_path: string;
  auto_dispatch_pm: number;
  max_parallel: number;
  version: number;
};

type Task = {
  id: string; code: string; title: string;
  status: string;
  assignee_role: string | null;
  rework_count: number;
  updated_at?: string;
};

const COLUMNS_WF1 = ['todo', 'agent_working', 'agent_review', 'human_approval', 'done'] as const;
const COLUMNS_WF2 = ['todo', 'agent_working', 'human_approval', 'done'] as const;

const ROLE_FOR_STATUS: Record<string, string> = {
  todo: 'pm',
  agent_working: 'worker',
  agent_review: 'reviewer',
  human_approval: 'human',
  done: 'human',
};

function needsAttention(t: Task): boolean {
  if ((t.rework_count ?? 0) > 2) return true;
  if (t.status === 'human_approval') {
    const ts = t.updated_at ? Date.parse(t.updated_at) : NaN;
    if (!Number.isNaN(ts) && Date.now() - ts > 24 * 3600_000) return true;
  }
  return false;
}

export function Board({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useCardView();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const qc = useQueryClient();

  const tasks = useQuery({ queryKey: ['tasks'], queryFn: api.listTasks });
  const total = useQuery({
    queryKey: ['costs-total', project.code],
    queryFn: () => api.projectCostsTotal(project.code),
  });

  const cols = project.workflow_type === 'WF1' ? COLUMNS_WF1 : COLUMNS_WF2;
  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = Object.fromEntries(cols.map(c => [c, []]));
    for (const task of tasks.data?.tasks ?? []) (g[task.status] ||= []).push(task);
    return g;
  }, [tasks.data, cols]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const transition = useMutation({
    mutationFn: async (input: { code: string; to: string }) => {
      return api.transition(input.code, {
        to_status: input.to,
        to_assignee: ROLE_FOR_STATUS[input.to] ?? 'human',
        by_role: 'human',
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setDraggingId(null);
    const code = e.active.data.current?.code as string | undefined;
    const fromStatus = e.active.data.current?.status as string | undefined;
    const targetCol = e.over?.id ? String(e.over.id) : null;
    if (!code || !targetCol || !fromStatus || targetCol === fromStatus) return;
    transition.mutate({ code, to: targetCol });
  }

  const activeTask = useMemo(
    () => (draggingId ? tasks.data?.tasks.find(x => x.code === draggingId) ?? null : null),
    [draggingId, tasks.data]
  );

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>
            {project.name} <span className="code">{project.code}</span>
          </h1>
          <span className="subtitle">{t(`wizard.${project.workflow_type.toLowerCase()}`, project.workflow_type)}</span>
        </div>
        <div className="actions">
          {total.data && (
            <span className="cost-header" title={`7d $${total.data.last_7d?.toFixed(4)} · 30d $${total.data.last_30d?.toFixed(4)}`}>
              {t('board.cost_total')} <span className="amount">${total.data.all_time?.toFixed(4) ?? '0.0000'}</span>
              {total.data.uncosted_runs > 0 && <span className="warn"> · {total.data.uncosted_runs} uncosted</span>}
            </span>
          )}
          <ViewToggle value={view} onChange={setView} />
          <button className="primary" onClick={() => setCreating(true)}>+ {t('board.new_task')}</button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="columns" style={{ ['--col-count' as any]: cols.length }}>
          {cols.map(c => (
            <DroppableColumn key={c} id={c} label={t(`board.${c}`)} count={grouped[c]?.length ?? 0}>
              {(grouped[c] ?? []).map(task => (
                <DraggableCard
                  key={task.id}
                  task={task}
                  view={view}
                  onClick={() => setSelected(task.code)}
                />
              ))}
            </DroppableColumn>
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask ? <CardView task={activeTask} view={view} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {creating && <CreateTaskModal onClose={() => setCreating(false)} />}
      {selected && (
        <TaskDetailPanel
          taskCode={selected}
          workflow={project.workflow_type}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function ViewToggle({ value, onChange }: { value: CardViewMode; onChange: (v: CardViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="view-toggle" role="tablist" aria-label={t('board.view', 'View')}>
      <button
        className={value === 'modern' ? 'active' : ''}
        onClick={() => onChange('modern')}
        role="tab" aria-selected={value === 'modern'}
      >{t('board.modern', 'Modern')}</button>
      <button
        className={value === 'classic' ? 'active' : ''}
        onClick={() => onChange('classic')}
        role="tab" aria-selected={value === 'classic'}
      >{t('board.classic', 'Classic')}</button>
    </div>
  );
}

function DroppableColumn({
  id, label, count, children,
}: { id: string; label: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={'column' + (isOver ? ' drop-hint' : '')}>
      <h2>{label}<span className="count">{count}</span></h2>
      <div className="cards">{children}</div>
    </div>
  );
}

function DraggableCard({
  task, view, onClick,
}: { task: Task; view: CardViewMode; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: task.code,
    data: { code: task.code, status: task.status },
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={e => { if (!isDragging) onClick(); e.stopPropagation(); }}
    >
      <CardView task={task} view={view} dragging={isDragging} />
    </div>
  );
}

function CardView({
  task, view, dragging = false, overlay = false,
}: { task: Task; view: CardViewMode; dragging?: boolean; overlay?: boolean }) {
  const { t } = useTranslation();
  const attention = needsAttention(task);
  const role = (task.assignee_role || '').toLowerCase();
  const live = task.status === 'agent_working' || task.status === 'agent_review';
  const cls = [
    'card',
    view === 'classic' ? 'classic' : 'modern',
    role ? `role-${role}` : '',
    attention ? 'needs-attention' : '',
    live ? 'live' : '',
    dragging ? 'dragging' : '',
    overlay ? 'is-drag-overlay' : '',
  ].filter(Boolean).join(' ');
  const isModern = view !== 'classic';
  return (
    <div className={cls}>
      {attention && <span className="attention-dot" aria-label={t('board.needs_attention', 'Needs attention')} />}
      <div className="row card-head">
        <span className="code">{task.code}</span>
        {(task.rework_count ?? 0) > 3 && <span className="stall-badge">{t('board.stalled')}</span>}
        {isModern && <span className="card-head-spacer" />}
        {isModern
          ? <span className="rec">{live ? 'LIVE' : 'IDLE'}</span>
          : <CostBadge taskCode={task.code} />}
      </div>
      <div className="card-title">{task.title}</div>
      <div className="card-foot">
        {task.assignee_role ? (
          <span className={`role-chip ${role}`}>{t(`role.${task.assignee_role}`, task.assignee_role)}</span>
        ) : <span className="muted">—</span>}
        <CostBadge taskCode={task.code} />
      </div>
    </div>
  );
}
