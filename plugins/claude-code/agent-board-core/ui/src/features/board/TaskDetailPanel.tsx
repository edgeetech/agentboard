import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';

type Variant = 'drawer' | 'inline';

export function TaskDetailPanel({
  taskCode, workflow, variant = 'drawer', onClose, onSwapVariant,
}: {
  taskCode: string;
  workflow: 'WF1' | 'WF2';
  variant?: Variant;
  onClose?: () => void;
  onSwapVariant?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectMsg, setRejectMsg] = useState('');

  const q = useQuery({
    queryKey: ['task', taskCode],
    queryFn: () => api.getTask(taskCode),
    refetchInterval: 3000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task', taskCode] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const dispatch = useMutation({
    mutationFn: (role: 'pm' | 'worker' | 'reviewer') => api.dispatch(taskCode, role),
    onSuccess: invalidate,
  });
  const cancel = useMutation({ mutationFn: () => api.cancelRun(taskCode), onSuccess: invalidate });
  const approve = useMutation({ mutationFn: () => api.approve(taskCode), onSuccess: invalidate });
  const reject = useMutation({
    mutationFn: () => api.reject(taskCode, rejectMsg),
    onSuccess: () => { invalidate(); setRejectOpen(false); setRejectMsg(''); },
  });
  const retry = useMutation({ mutationFn: () => api.retryFromWorker(taskCode), onSuccess: invalidate });
  const del = useMutation({
    mutationFn: () => api.deleteTask(taskCode),
    onSuccess: () => { invalidate(); onClose?.(); },
  });

  const Wrapper = variant === 'drawer' ? 'aside' : 'div';
  const wrapperClass = variant === 'drawer' ? 'detail-panel' : 'detail-inline';

  const [tab, setTab] = useState<'runs' | 'comments'>('runs');

  if (q.isLoading || !q.data) {
    return <Wrapper className={wrapperClass}><div className="center"><div className="spinner" /></div></Wrapper>;
  }
  const { task, project, comments, runs } = q.data;
  const ac = safeParseAc(task.acceptance_criteria_json);
  const hasRunningRun = runs.some((r: any) => r.status === 'running' || r.status === 'queued');
  const projectLabel = project?.name || project?.code || '—';

  return (
    <Wrapper className={wrapperClass}>
      <header className="detail-head">
        <div className="detail-head-title">
          <span className="code">{task.code}</span>
          <h2 title={task.title}>{task.title}</h2>
          <div className="detail-head-icons">
            {onSwapVariant && (
              <button
                className="icon-btn"
                type="button"
                onClick={onSwapVariant}
                title={variant === 'drawer' ? t('task.open_page', 'Open as page') : t('task.open_panel', 'Open as panel')}
                aria-label={variant === 'drawer' ? t('task.open_page', 'Open as page') : t('task.open_panel', 'Open as panel')}
              >
                {variant === 'drawer'
                  ? <SvgIcon d="M4 10 V4 H10 M14 8 V14 H8 M4 4 L14 14" />
                  : <SvgIcon d="M5 2 H14 V11 M6 12 L14 4 M2 8 V16 H10" />}
              </button>
            )}
            {variant === 'drawer' && onClose && (
              <button
                className="icon-btn close"
                onClick={onClose}
                title={t('common.close')}
                aria-label={t('common.close')}
              >
                <SvgIcon d="M4 4 L14 14 M14 4 L4 14" />
              </button>
            )}
          </div>
        </div>
        <div className="detail-head-meta">
          <span className="meta-proj" title={project?.repo_path}>{projectLabel}</span>
          <span className="meta-sep">·</span>
          {task.assignee_role ? (
            <span className="meta-assignee">
              <RoleAvatar role={task.assignee_role} label={t(`role.${task.assignee_role}`, { defaultValue: task.assignee_role })} />
              <span>{t(`role.${task.assignee_role}`)}</span>
            </span>
          ) : <span className="muted">unassigned</span>}
          <span className="meta-sep">·</span>
          <span className={`tag status-${task.status}`}>{t(`board.${task.status}`)}</span>
        </div>
      </header>

      <div className="detail-body">
        {task.description && <p className="description">{task.description}</p>}

        <section>
          <h3>{t('task.ac')} ({ac.filter((a: any) => a.checked).length}/{ac.length})</h3>
          <ul className="ac-list">
            {ac.map((a: any) => (
              <li key={a.id}><input type="checkbox" checked={a.checked} readOnly /> {a.text}</li>
            ))}
            {ac.length === 0 && <li className="muted">(none yet — PM will populate)</li>}
          </ul>
        </section>

        <div className="detail-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'runs'}
            className={`tab${tab === 'runs' ? ' active' : ''}`}
            onClick={() => setTab('runs')}
          >
            {t('task.runs')} <span className="count">{runs.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'comments'}
            className={`tab${tab === 'comments' ? ' active' : ''}`}
            onClick={() => setTab('comments')}
          >
            {t('task.comments')} <span className="count">{comments.length}</span>
          </button>
        </div>

        {tab === 'runs' && (
          <section role="tabpanel">
            <ul className="run-list">
              {runs.map((r: any) => (
                <li key={r.id} className={`run run-${r.status}`}>
                  <span className="run-role">{t(`role.${r.role}`)}</span>
                  <span className="run-status">{r.status}</span>
                  {r.cost_usd != null && <span className="run-cost">${r.cost_usd.toFixed(4)}</span>}
                  {r.error && <span className="err inline">{String(r.error).slice(0, 80)}</span>}
                  <a href={`/api/logs/${r.id}`} target="_blank" rel="noreferrer">log</a>
                  <CopyContextButton task={task} project={project} comments={comments} />

                </li>
              ))}
              {runs.length === 0 && <li className="muted">(no runs yet)</li>}
            </ul>
          </section>
        )}

        {tab === 'comments' && (
          <section role="tabpanel">
            <ul className="comments">
              {comments.map((c: any) => (
                <li key={c.id} className={`comment author-${c.author_role}`}>
                  <div className="author">{t(`role.${c.author_role}`)}</div>
                  <pre>{c.body}</pre>
                </li>
              ))}
              {comments.length === 0 && <li className="muted">(no comments yet)</li>}
            </ul>
          </section>
        )}
      </div>

      <footer className="detail-foot">
        <div className="actions">
          {task.status === 'todo' && !hasRunningRun && (
            <button onClick={() => dispatch.mutate('pm')}>{t('task.run_pm')}</button>
          )}
          {task.status === 'agent_working' && task.assignee_role === 'worker' && !hasRunningRun && (
            <button onClick={() => dispatch.mutate('worker')}>{t('task.run_worker')}</button>
          )}
          {task.status === 'agent_review' && !hasRunningRun && workflow === 'WF1' && (
            <button onClick={() => dispatch.mutate('reviewer')}>{t('task.run_reviewer')}</button>
          )}
          {hasRunningRun && (
            <button onClick={() => cancel.mutate()}>{t('task.cancel_run')}</button>
          )}
          {task.status === 'human_approval' && (
            <>
              <button className="primary" onClick={() => approve.mutate()}>{t('task.approve')}</button>
              <button onClick={() => setRejectOpen(true)}>{t('task.reject')}</button>
            </>
          )}
          {task.rework_count > 3 && (
            <button className="warn" onClick={() => retry.mutate()}>{t('task.retry_from_worker')}</button>
          )}
          <button
            className="danger"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (confirm(t('common.confirm_delete', { code: task.code }))) del.mutate();
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      </footer>

      {rejectOpen && (
        <div className="modal-overlay" onClick={() => setRejectOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{t('task.reject_title')}</h2>
            <textarea
              value={rejectMsg}
              onChange={e => setRejectMsg(e.target.value)}
              placeholder={t('task.reject_prompt')}
              rows={4}
              autoFocus
            />
            <div className="actions">
              <button className="ghost" onClick={() => setRejectOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="danger"
                disabled={rejectMsg.trim().length < 10}
                onClick={() => reject.mutate()}
              >
                {t('task.reject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Wrapper>
  );
}

function safeParseAc(s: string): any[] {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

function SvgIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

function RoleAvatar({ role, label }: { role: string; label: string }) {
  const initials = initialsFromLabel(label);
  return (
    <span className={`avatar role-${role}`} title={label} aria-label={label}>
      <span className="avatar-initials">{initials}</span>
    </span>
  );
}

/**
 * Copies a markdown-formatted context block to the clipboard so the user can
 * paste it into a fresh interactive `claude` session in the repo and pick up
 * where the agent left off. Headless `claude -p` sessions aren't reliably
 * resumable via `--resume`, so we hand the user the raw context instead.
 */
function CopyContextButton({
  task, project, comments,
}: { task: any; project: any; comments: any[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function buildContext(): string {
    const ac = safeParseAc(task.acceptance_criteria_json);
    const acBlock = ac.length
      ? ac.map((a: any, i: number) => `${i + 1}. [${a.checked ? 'x' : ' '}] ${a.text}`).join('\n')
      : '(none)';
    const recent = comments.slice(-8)
      .map((c: any) => `- [${c.author_role}] ${String(c.body).slice(0, 400)}`)
      .join('\n') || '(none)';
    return [
      `# Agentboard handoff — ${task.code}: ${task.title}`,
      ``,
      `**Project**: ${project?.name ?? '—'} (\`${project?.repo_path ?? ''}\`)`,
      `**Status**: ${task.status}    **Assignee**: ${task.assignee_role ?? '—'}`,
      ``,
      `## Description`,
      task.description || '(empty)',
      ``,
      `## Acceptance criteria`,
      acBlock,
      ``,
      `## Recent comments`,
      recent,
      ``,
      `---`,
      `Please continue work on this task from here. Update the agentboard MCP if available; otherwise respond with progress.`,
    ].join('\n');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildContext());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  }
  return (
    <button
      type="button"
      className="linkish run-resume"
      onClick={copy}
      title={t('task.copy_context_hint', 'Copies task context as markdown — paste into a fresh `claude` session in the repo to jump in.')}
    >
      {copied ? t('common.copied', 'Copied') : `⏎ ${t('task.copy_context', 'Copy context')}`}
    </button>
  );
}
