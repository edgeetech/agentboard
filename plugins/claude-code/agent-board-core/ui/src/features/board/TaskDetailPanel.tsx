import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, getProjectCode } from '../../api';
import { FileDropZone } from './FileDropZone';

type Variant = 'drawer' | 'inline';

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export function TaskDetailPanel({
  taskCode, workflow: _workflow, variant = 'drawer', onClose, onSwapVariant,
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
  const [rejectFilePaths, setRejectFilePaths] = useState<string[]>([]);
  const [tab, setTab] = useState<'files' | 'comments' | 'agent_runs'>('agent_runs');
  const [elapsedTimes, setElapsedTimes] = useState<Record<string, number>>({});
  const [runAgentRole, setRunAgentRole] = useState<'pm' | 'worker' | 'reviewer'>('worker');
  const [commentDraft, setCommentDraft] = useState('');

  const projectCode = getProjectCode();
  const q = useQuery({
    queryKey: ['task', projectCode, taskCode],
    queryFn: () => api.getTask(taskCode),
    refetchInterval: 3000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task', projectCode, taskCode] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };

  const approve = useMutation({ mutationFn: () => api.approve(taskCode), onSuccess: invalidate });
  const reject = useMutation({
    mutationFn: async () => {
      await api.reject(taskCode, rejectMsg);
      const validPaths = rejectFilePaths.map(p => p.trim()).filter(Boolean);
      for (const fp of validPaths) {
        await api.addFilePath(taskCode, fp);
      }
    },
    onSuccess: () => {
      invalidate();
      setRejectOpen(false);
      setRejectMsg('');
      setRejectFilePaths([]);
    },
  });
  const addFilePath = useMutation({
    mutationFn: (fp: string) => api.addFilePath(taskCode, fp),
    onSuccess: invalidate,
  });
  const deleteFilePath = useMutation({
    mutationFn: (fpId: string) => api.deleteFilePath(taskCode, fpId),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: () => api.deleteTask(taskCode),
    onSuccess: () => { invalidate(); onClose?.(); },
  });
  const runAgent = useMutation({
    mutationFn: (role: 'pm' | 'worker' | 'reviewer') => api.runAgent(taskCode, role),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.message || 'Run agent failed'),
  });
  const addComment = useMutation({
    mutationFn: (body: string) => api.addComment(taskCode, body),
    onSuccess: () => { invalidate(); setCommentDraft(''); },
    onError: (err: any) => alert(err?.message || 'Add comment failed'),
  });

  // Update elapsed times for running agents
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTimes((prev) => {
        const updated = { ...prev };
        let changed = false;
        if (q.data?.agent_runs) {
          for (const run of q.data.agent_runs) {
            if (run.status === 'running' && run.started_at) {
              const elapsed = Math.floor((Date.now() - new Date(run.started_at).getTime()) / 1000);
              if (updated[run.id] !== elapsed) {
                updated[run.id] = elapsed;
                changed = true;
              }
            }
          }
        }
        return changed ? updated : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [q.data?.agent_runs]);

  const Wrapper = variant === 'drawer' ? 'aside' : 'div';
  const wrapperClass = variant === 'drawer' ? 'detail-panel' : 'detail-inline';

  if (q.isLoading || !q.data) {
    return <Wrapper className={wrapperClass}><div className="center"><div className="spinner" /></div></Wrapper>;
  }
  const { task, project, comments, file_paths, agent_runs } = q.data;
  const ac = safeParseAc(task.acceptance_criteria_json);
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
            {ac.length === 0 && <li className="muted">(none)</li>}
          </ul>
        </section>

        <div className="detail-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'agent_runs'}
            className={`tab${tab === 'agent_runs' ? ' active' : ''}`}
            onClick={() => setTab('agent_runs')}
          >
            {t('task.agent_runs', 'Agent Runs')} <span className="count">{agent_runs?.length ?? 0}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'comments'}
            className={`tab${tab === 'comments' ? ' active' : ''}`}
            onClick={() => setTab('comments')}
          >
            {t('task.comments')} <span className="count">{comments.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'files'}
            className={`tab${tab === 'files' ? ' active' : ''}`}
            onClick={() => setTab('files')}
          >
            {t('task.files', 'Files')} <span className="count">{file_paths?.length ?? 0}</span>
          </button>
        </div>

        {tab === 'files' && (
          <section role="tabpanel" className="files-tab">
            {(file_paths ?? []).length > 0 && (
              <ul className="file-path-list saved">
                {(file_paths ?? []).map((fp: any) => (
                  <li key={fp.id} className="file-path-entry saved">
                    <span className="file-path-icon">📄</span>
                    <span className="file-path-text" title={fp.file_path}>{fp.file_path}</span>
                    <button
                      type="button"
                      className="icon-btn danger-hover"
                      onClick={() => deleteFilePath.mutate(fp.id)}
                      title={t('common.remove', 'Remove')}
                      aria-label={t('common.remove', 'Remove')}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <AddFilePathRow onAdd={fp => addFilePath.mutate(fp)} />
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
            <div className="add-comment-row" style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder={t('task.add_comment_placeholder', 'Add guidance for active or future agents…')}
                rows={3}
                disabled={addComment.isPending}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={addComment.isPending || commentDraft.trim().length === 0}
                  onClick={() => addComment.mutate(commentDraft.trim())}
                >
                  {t('task.add_comment', 'Add comment')}
                </button>
              </div>
            </div>
          </section>
        )}

        {tab === 'agent_runs' && (
          <section role="tabpanel">
            <ul className="agent-runs-list">
              {(agent_runs ?? []).map((run: any) => (
                <li key={run.id} className={`agent-run status-${run.status}`}>
                  <div className="run-header">
                    <span className="role-badge">{run.role}</span>
                    <span className={`status-badge status-${run.status}`}>{run.status}</span>
                    {run.status === 'running' && run.started_at && (
                      <span className="elapsed-time">⏱ {formatElapsed(elapsedTimes[run.id] ?? 0)}</span>
                    )}
                    {run.claude_session_id && (
                      <ResumeRunButton
                        sessionId={run.claude_session_id}
                        repoPath={project?.repo_path}
                      />
                    )}
                  </div>
                  <div className="run-timestamps">
                    <span className="queued">{new Date(run.queued_at).toLocaleString()}</span>
                    {run.started_at && !run.ended_at && <span className="started">{new Date(run.started_at).toLocaleString()}</span>}
                    {run.ended_at && <span className="ended">{new Date(run.ended_at).toLocaleString()}</span>}
                  </div>
                  {run.model && <div className="run-model">{run.model} · {run.cost_usd ? `$${run.cost_usd.toFixed(4)}` : 'calculating...'}</div>}
                  {run.summary && <div className="run-summary">{run.summary}</div>}
                  {run.error && <div className="run-error">❌ Error: {run.error}</div>}
                </li>
              ))}
              {(agent_runs ?? []).length === 0 && <li className="muted">(no agent runs yet)</li>}
            </ul>
          </section>
        )}
      </div>

      <footer className="detail-foot">
        <div className="actions">
          {task.status === 'human_approval' && (
            <>
              <button className="primary" onClick={() => approve.mutate()}>{t('task.approve')}</button>
              <button onClick={() => setRejectOpen(true)}>{t('task.reject')}</button>
            </>
          )}
          {(() => {
            const hasActiveRun = (agent_runs ?? []).some(
              (r: any) => r.status === 'queued' || r.status === 'running'
            );
            return (
              <span className="run-agent-group" style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                <select
                  value={runAgentRole}
                  onChange={(e) => setRunAgentRole(e.target.value as 'pm' | 'worker' | 'reviewer')}
                  disabled={runAgent.isPending || hasActiveRun}
                  aria-label={t('task.run_agent_role', 'Agent role')}
                >
                  <option value="pm">{t('role.pm', 'PM')}</option>
                  <option value="worker">{t('role.worker', 'Worker')}</option>
                  <option value="reviewer">{t('role.reviewer', 'Reviewer')}</option>
                </select>
                <button
                  type="button"
                  onClick={() => runAgent.mutate(runAgentRole)}
                  disabled={runAgent.isPending || hasActiveRun}
                  title={hasActiveRun ? t('task.run_agent_busy', 'Run already queued/active') : ''}
                >
                  {t('task.run_agent', 'Run Agent')}
                </button>
              </span>
            );
          })()}
          <CopyContextButton task={task} project={project} comments={comments} />
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
            <label style={{ marginTop: '0.75rem', display: 'block' }}>
              {t('files.label', 'File paths')}
            </label>
            <FileDropZone paths={rejectFilePaths} onChange={setRejectFilePaths} />
            <div className="actions">
              <button className="ghost" onClick={() => setRejectOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="danger"
                disabled={rejectMsg.trim().length < 10 || reject.isPending}
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

function AddFilePathRow({ onAdd }: { onAdd: (fp: string) => void }) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<string[]>([]);

  function commit() {
    const valid = drafts.map(p => p.trim()).filter(Boolean);
    valid.forEach(fp => onAdd(fp));
    setDrafts([]);
  }

  return (
    <div className="add-file-path-row">
      <FileDropZone paths={drafts} onChange={setDrafts} />
      {drafts.length > 0 && (
        <button type="button" className="primary" onClick={commit} style={{ marginTop: '0.5rem' }}>
          {t('files.save_paths', 'Save paths')}
        </button>
      )}
    </div>
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

function ResumeRunButton({
  sessionId, repoPath,
}: { sessionId: string; repoPath: string | null | undefined }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const cmd = repoPath
    ? `cd "${repoPath}"; claude --resume ${sessionId}`
    : `claude --resume ${sessionId}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }
  return (
    <button
      type="button"
      className={`resume-chip${copied ? ' is-copied' : ''}`}
      onClick={copy}
      title={copied ? t('task.resume_copied', 'Copied — paste in terminal') : cmd}
      aria-label={t('task.resume', 'Resume session')}
    >
      <span className="resume-chip-glyph" aria-hidden>{copied ? '✓' : '›_'}</span>
      <span className="resume-chip-id mono">{sessionId.slice(0, 8)}</span>
    </button>
  );
}

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
      `Please continue work on this task from here.`,
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
      className="linkish"
      onClick={copy}
      title={t('task.copy_context_hint', 'Copies task context as markdown — paste into a fresh `claude` session.')}
    >
      {copied ? t('common.copied', 'Copied') : `⏎ ${t('task.copy_context', 'Copy context')}`}
    </button>
  );
}
