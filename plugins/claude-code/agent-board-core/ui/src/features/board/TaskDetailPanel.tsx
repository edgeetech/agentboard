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

  if (q.isLoading || !q.data) {
    return <Wrapper className={wrapperClass}><div className="center"><div className="spinner" /></div></Wrapper>;
  }
  const { task, comments, runs } = q.data;
  const ac = safeParseAc(task.acceptance_criteria_json);
  const hasRunningRun = runs.some((r: any) => r.status === 'running' || r.status === 'queued');

  return (
    <Wrapper className={wrapperClass}>
      <div className="detail-head">
        {variant === 'drawer' ? (
          <button className="close" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>×</button>
        ) : null}
        <span className="code">{task.code}</span>
        <span className={`tag status-${task.status}`}>{t(`board.${task.status}`)}</span>
        {task.assignee_role && (
          <RoleAvatar role={task.assignee_role} label={t(`role.${task.assignee_role}`, { defaultValue: task.assignee_role })} />
        )}
        <span style={{ flex: 1 }} />
        {onSwapVariant && (
          <button
            className="ghost"
            type="button"
            onClick={onSwapVariant}
            title={variant === 'drawer' ? t('task.open_page', 'Open as page') : t('task.open_panel', 'Open as panel')}
          >
            {variant === 'drawer' ? t('task.view_page', 'Full view') : t('task.view_panel', 'Panel view')}
          </button>
        )}
      </div>

      <h2>{task.title}</h2>
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

      <section>
        <h3>{t('task.runs')}</h3>
        <ul className="run-list">
          {runs.map((r: any) => (
            <li key={r.id} className={`run run-${r.status}`}>
              <span className="run-role">{t(`role.${r.role}`)}</span>
              <span className="run-status">{r.status}</span>
              {r.cost_usd != null && <span className="run-cost">${r.cost_usd.toFixed(4)}</span>}
              {r.error && <span className="err inline">{String(r.error).slice(0, 80)}</span>}
              <a href={`/api/logs/${r.id}`} target="_blank" rel="noreferrer">log</a>
            </li>
          ))}
          {runs.length === 0 && <li className="muted">(no runs yet)</li>}
        </ul>
      </section>

      <section>
        <h3>{t('task.comments')} ({comments.length})</h3>
        <ul className="comments">
          {comments.map((c: any) => (
            <li key={c.id} className={`comment author-${c.author_role}`}>
              <div className="author">{t(`role.${c.author_role}`)}</div>
              <pre>{c.body}</pre>
            </li>
          ))}
        </ul>
      </section>

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
