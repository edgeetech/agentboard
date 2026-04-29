import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { api } from "../../api";
import { CreateTaskModal } from "./CreateTaskModal";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { useDetailView } from "../../hooks/useDetailView";
import { SearchIcon } from "../../components/SearchIcon";
import { iconForStatus, WorkingDots } from "./ColumnIcons";

type ViewMode = "board" | "list";
const VIEW_MODE_KEY = "ab.board.viewMode";
function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "board",
  );
  function set(v: ViewMode) {
    localStorage.setItem(VIEW_MODE_KEY, v);
    setMode(v);
  }
  return [mode, set];
}

type Project = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  workflow_type: "WF1" | "WF2";
  repo_path: string;
  auto_dispatch_pm: number;
  max_parallel: number;
  agent_provider: "claude" | "github_copilot";
  version: number;
};

type Task = {
  id: string;
  code: string;
  title: string;
  status: string;
  assignee_role: string | null;
  rework_count: number;
  updated_at?: string;
  has_active_run?: number | boolean;
};

const COLUMNS_WF1 = [
  "todo",
  "agent_working",
  "agent_review",
  "human_approval",
  "done",
] as const;
const COLUMNS_WF2 = [
  "todo",
  "agent_working",
  "human_approval",
  "done",
] as const;

const ROLE_FOR_STATUS: Record<string, string> = {
  todo: "pm",
  agent_working: "worker",
  agent_review: "reviewer",
  human_approval: "human",
  done: "human",
};

function needsAttention(t: Task): boolean {
  if ((t.rework_count ?? 0) > 2) return true;
  if (t.status === "human_approval") {
    const ts = t.updated_at ? Date.parse(t.updated_at) : NaN;
    if (!Number.isNaN(ts) && Date.now() - ts > 24 * 3600_000) return true;
  }
  return false;
}

export function Board({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [, setDetailView] = useDetailView();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [viewMode, setViewMode] = useViewMode();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();

  useEffect(() => {
    if (errorMsg) {
      const timer = setTimeout(() => setErrorMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMsg]);

  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(searchInput.trim()), 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Support ?open=<code> query param (used when swapping from page → panel).
  useEffect(() => {
    const open = search.get("open");
    if (open) {
      setSelected(open);
      const next = new URLSearchParams(search);
      next.delete("open");
      setSearch(next, { replace: true });
    }
  }, [search, setSearch]);

  function openTask(code: string) {
    setSelected(code);
  }

  const tasks = useQuery({
    queryKey: ["tasks", project.code, searchDebounced],
    queryFn: () => api.listTasks(searchDebounced || undefined),
  });
  const total = useQuery({
    queryKey: ["costs-total", project.code],
    queryFn: () => api.projectCostsTotal(project.code),
  });

  const cols = project.workflow_type === "WF1" ? COLUMNS_WF1 : COLUMNS_WF2;
  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = Object.fromEntries(
      cols.map((c) => [c, []]),
    );
    for (const task of tasks.data?.tasks ?? [])
      (g[task.status] ||= []).push(task);

    // Apply sorting to each column's tasks
    if (sortColumn) {
      for (const status of cols) {
        g[status].sort((a: any, b: any) => {
          let aVal = a[sortColumn];
          let bVal = b[sortColumn];
          
          // Handle nulls
          if (aVal === null || aVal === undefined) aVal = '';
          if (bVal === null || bVal === undefined) bVal = '';
          
          // Handle numeric values
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
          }
          
          // String comparison
          const cmp = String(aVal).localeCompare(String(bVal));
          return sortDirection === 'asc' ? cmp : -cmp;
        });
      }
    }
    return g;
  }, [tasks.data, cols, sortColumn, sortDirection]);

  function toggleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const transition = useMutation({
    mutationFn: async (input: { code: string; to: string }) => {
      return api.transition(input.code, {
        to_status: input.to,
        to_assignee: ROLE_FOR_STATUS[input.to] ?? "human",
        by_role: "human",
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (error: any) => {
      const msg = error?.response?.data?.error || (error as Error)?.message || 'Failed to transition task';
      setErrorMsg(msg);
    },
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
    () =>
      draggingId
        ? (tasks.data?.tasks.find((x) => x.code === draggingId) ?? null)
        : null,
    [draggingId, tasks.data],
  );

  return (
    <>
      {errorMsg && (
        <div className='toast-error' role='alert'>
          {errorMsg}
        </div>
      )}
      <div className='page-head'>
        <div className='title'>
          <h1>
            {project.name} <span className='code'>{project.code}</span>
          </h1>
        </div>
        <div className='actions'>
          <label className='search-bar'>
            <SearchIcon />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("board.search", "Search tasks…")}
              aria-label='Search tasks'
            />
          </label>
          {total.data && (
            <span
              className='cost-header'
              title={`7d $${total.data.last_7d?.toFixed(4)} · 30d $${total.data.last_30d?.toFixed(4)}`}
            >
              {t("board.cost_total")}{" "}
              <span className='amount'>
                ${total.data.all_time?.toFixed(4) ?? "0.0000"}
              </span>
              {total.data.uncosted_runs > 0 && (
                <span className='warn'>
                  {" "}
                  · {total.data.uncosted_runs} uncosted
                </span>
              )}
            </span>
          )}
          <div className='view-toggle'>
            <button
              className={viewMode === "board" ? "active" : ""}
              onClick={() => setViewMode("board")}
              title='Board view'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 14 14'
                fill='none'
                aria-hidden='true'
              >
                <rect
                  x='0'
                  y='0'
                  width='4'
                  height='14'
                  rx='1'
                  fill='currentColor'
                />
                <rect
                  x='5'
                  y='0'
                  width='4'
                  height='14'
                  rx='1'
                  fill='currentColor'
                />
                <rect
                  x='10'
                  y='0'
                  width='4'
                  height='14'
                  rx='1'
                  fill='currentColor'
                />
              </svg>
            </button>
            <button
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
              title='List view'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 14 14'
                fill='none'
                aria-hidden='true'
              >
                <rect
                  x='0'
                  y='1'
                  width='14'
                  height='2'
                  rx='1'
                  fill='currentColor'
                />
                <rect
                  x='0'
                  y='6'
                  width='14'
                  height='2'
                  rx='1'
                  fill='currentColor'
                />
                <rect
                  x='0'
                  y='11'
                  width='14'
                  height='2'
                  rx='1'
                  fill='currentColor'
                />
              </svg>
            </button>
          </div>
          <div className='action-group'>
            <button className='primary' onClick={() => setCreating(true)}>
              + {t("board.new_task")}
            </button>
          </div>
        </div>
      </div>

      {viewMode === "list" ? (
        <TaskListView
          tasks={tasks.data?.tasks ?? []}
          onOpen={openTask}
          onDeleted={() => qc.invalidateQueries({ queryKey: ["tasks"] })}
        />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div
            className='columns'
            style={{ ["--col-count" as any]: cols.length }}
          >
            {cols.map((c) => (
              <DroppableColumn
                key={c}
                id={c}
                status={c}
                label={t(`board.${c}`)}
                count={grouped[c]?.length ?? 0}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onToggleSort={toggleSort}
              >
                {(grouped[c] ?? []).map((task) => (
                  <DraggableCard
                    key={task.id}
                    task={task}
                    onClick={() => openTask(task.code)}
                  />
                ))}
              </DroppableColumn>
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeTask ? <CardView task={activeTask} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {creating && <CreateTaskModal onClose={() => setCreating(false)} />}
      {selected && (
        <TaskDetailPanel
          taskCode={selected}
          workflow={project.workflow_type}
          variant='drawer'
          onClose={() => setSelected(null)}
          onSwapVariant={() => {
            setDetailView("page");
            navigate(
              `/projects/${encodeURIComponent(project.code)}/tasks/${encodeURIComponent(selected)}`,
            );
          }}
        />
      )}
    </>
  );
}

function DroppableColumn({
  id,
  status,
  label,
  count,
  sortColumn,
  sortDirection,
  onToggleSort,
  children,
}: {
  id: string;
  status: string;
  label: string;
  count: number;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onToggleSort: (col: string) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const isSorted = sortColumn === id;
  return (
    <div
      ref={setNodeRef}
      className={`column col-${status}` + (isOver ? " drop-hint" : "")}
    >
      <h2 onClick={() => onToggleSort(id)} style={{ cursor: 'pointer' }}>
        <span className='col-icon-wrap'>{iconForStatus(status)}</span>
        <span className='col-label'>{label}</span>
        <span className='count'>{count}</span>
        {isSorted && (
          <span className='sort-indicator' title={`Sorted ${sortDirection}`}>
            {sortDirection === 'asc' ? ' ↑' : ' ↓'}
          </span>
        )}
      </h2>
      <div className='cards'>{children}</div>
    </div>
  );
}

function DraggableCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } =
    useDraggable({
      id: task.code,
      data: { code: task.code, status: task.status },
    });
  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        if (!isDragging) onClick();
        e.stopPropagation();
      }}
    >
      <CardView task={task} dragging={isDragging} />
    </div>
  );
}

function CardView({
  task,
  dragging = false,
  overlay = false,
}: {
  task: Task;
  dragging?: boolean;
  overlay?: boolean;
}) {
  const { t } = useTranslation();
  const attention = needsAttention(task);
  const role = (task.assignee_role || "").toLowerCase();
  const live =
    task.status === "agent_working" || task.status === "agent_review";
  const cls = [
    "card",
    role ? `role-${role}` : "",
    attention ? "needs-attention" : "",
    live ? "live" : "",
    dragging ? "dragging" : "",
    overlay ? "is-drag-overlay" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      {attention && (
        <span
          className='attention-dot'
          aria-label={t("board.needs_attention", "Needs attention")}
        />
      )}
      <div className='row card-head'>
        <span className='code'>{task.code}</span>
        {(task.rework_count ?? 0) > 3 && (
          <span className='stall-badge'>{t("board.stalled")}</span>
        )}
      </div>
      <div className='card-title'>{task.title}</div>
      <div className='card-foot'>
        {task.assignee_role ? (
          <span className={`role-chip ${role}`}>
            {t(`role.${task.assignee_role}`, task.assignee_role)}
          </span>
        ) : (
          <span className='muted'>—</span>
        )}
        {!!task.has_active_run && <WorkingDots />}
      </div>
    </div>
  );
}

function TaskCostCell({ code }: { code: string }) {
  const cost = useQuery({
    queryKey: ['task-cost', code],
    queryFn: () => api.getTaskCost(code),
  });
  
  if (!cost.data) return <span className='muted task-cost-cell'>—</span>;
  
  const total = cost.data.cost_usd ?? 0;
  const runs = cost.data.run_count ?? 0;
  
  return (
    <span 
      className='task-cost-cell'
      title={`${runs} run(s) · $${total.toFixed(4)}`}
    >
      ${total.toFixed(4)}
    </span>
  );
}

function TaskListView({
  tasks,
  onOpen,
  onDeleted,
}: {
  tasks: Task[];
  onOpen: (code: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const del = useMutation({
    mutationFn: (code: string) => api.deleteTask(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onDeleted();
    },
  });

  if (tasks.length === 0) {
    return (
      <div className='task-list-empty muted'>
        {t("board.no_tasks", "No tasks yet.")}
      </div>
    );
  }

  return (
    <div className='task-list-wrap'>
      <table className='task-list-table'>
        <thead>
          <tr>
            <th className='col-code'>{t("board.col_code", "#")}</th>
            <th className='col-title'>{t("board.col_title", "Title")}</th>
            <th className='col-status'>{t("board.col_status", "Status")}</th>
            <th className='col-assignee'>
              {t("board.col_assignee", "Assignee")}
            </th>
            <th className='col-cost'>{t("board.col_cost", "Cost")}</th>
            <th className='col-actions'>{t("board.col_actions", "Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const role = (task.assignee_role || "").toLowerCase();
            return (
              <tr
                key={task.id}
                className={needsAttention(task) ? "row-attention" : ""}
              >
                <td className='col-code'>
                  <span className='mono task-code'>{task.code}</span>
                </td>
                <td className='col-title'>
                  <span className='task-title-cell' title={task.title}>
                    {task.title}
                  </span>
                </td>
                <td className='col-status'>
                  <span className={`tag status-${task.status}`}>
                    {t(`board.${task.status}`, task.status)}
                  </span>
                </td>
                <td className='col-assignee'>
                  {task.assignee_role ? (
                    <span className={`role-chip ${role}`}>
                      {t(`role.${task.assignee_role}`, task.assignee_role)}
                    </span>
                  ) : (
                    <span className='muted'>—</span>
                  )}
                </td>
                <td className='col-cost'>
                  <TaskCostCell code={task.code} />
                </td>
                <td className='col-actions'>
                  <div className='task-list-actions'>
                    <button
                      className='icon-btn'
                      title={t("common.view", "View detail")}
                      onClick={() => onOpen(task.code)}
                    >
                      <svg
                        width='15'
                        height='15'
                        viewBox='0 0 15 15'
                        fill='none'
                        aria-hidden='true'
                      >
                        <path
                          d='M7.5 2C4.4 2 1.8 4 .5 7.5 1.8 11 4.4 13 7.5 13s5.7-2 7-5.5C13.2 4 10.6 2 7.5 2z'
                          stroke='currentColor'
                          strokeWidth='1.3'
                          fill='none'
                        />
                        <circle
                          cx='7.5'
                          cy='7.5'
                          r='2'
                          stroke='currentColor'
                          strokeWidth='1.3'
                          fill='none'
                        />
                      </svg>
                    </button>
                    <button
                      className='icon-btn danger-hover'
                      title={t("common.delete", "Delete")}
                      disabled={del.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            t("common.confirm_delete", { code: task.code }),
                          )
                        )
                          del.mutate(task.code);
                      }}
                    >
                      <svg
                        width='14'
                        height='14'
                        viewBox='0 0 14 14'
                        fill='none'
                        aria-hidden='true'
                      >
                        <path
                          d='M1 3h12M5 3V2h4v1M2 3l1 9h8l1-9'
                          stroke='currentColor'
                          strokeWidth='1.3'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                        <path
                          d='M5.5 6v4M8.5 6v4'
                          stroke='currentColor'
                          strokeWidth='1.3'
                          strokeLinecap='round'
                        />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
