import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { api, getProjectCode } from '../../api';

import { DebtList } from './DebtList';
import { FileDropZone } from './FileDropZone';
import { PhaseTimeline } from './PhaseTimeline';

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
  const [runAgentProvider, setRunAgentProvider] = useState<
    'default' | 'claude' | 'github_copilot' | 'codex' | 'council'
  >('default');
  const [commentDraft, setCommentDraft] = useState('');
  const [runPickerOpen, setRunPickerOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [phaseOpen, setPhaseOpen] = useState(false);

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
    mutationFn: (input: {
      role: 'pm' | 'worker' | 'reviewer';
      providerChoice: 'default' | 'claude' | 'github_copilot' | 'codex' | 'council';
    }) => {
      const opts: { provider?: 'claude' | 'github_copilot' | 'codex'; use_council?: boolean } = {};
      if (input.providerChoice === 'council') opts.use_council = true;
      else if (input.providerChoice !== 'default') opts.provider = input.providerChoice;
      return api.runAgent(taskCode, input.role, opts);
    },
    onSuccess: invalidate,
    onError: (err: any) => { alert(err?.message || 'Run agent failed'); },
  });
  const cancelRun = useMutation({
    mutationFn: () => api.cancelRun(taskCode),
    onSuccess: invalidate,
    onError: (err: any) => { alert(err?.message || 'Cancel failed'); },
  });
  const addComment = useMutation({
    mutationFn: (body: string) => api.addComment(taskCode, body),
    onSuccess: () => { invalidate(); setCommentDraft(''); },
    onError: (err: any) => { alert(err?.message || 'Add comment failed'); },
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
    return () => { clearInterval(timer); };
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
            onClick={() => { setTab('agent_runs'); }}
          >
            {t('task.agent_runs', 'Agent Runs')} <span className="count">{agent_runs?.length ?? 0}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'comments'}
            className={`tab${tab === 'comments' ? ' active' : ''}`}
            onClick={() => { setTab('comments'); }}
          >
            {t('task.comments')} <span className="count">{comments.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'files'}
            className={`tab${tab === 'files' ? ' active' : ''}`}
            onClick={() => { setTab('files'); }}
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
                      onClick={() => { deleteFilePath.mutate(fp.id); }}
                      title={t('common.remove', 'Remove')}
                      aria-label={t('common.remove', 'Remove')}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <AddFilePathRow onAdd={fp => { addFilePath.mutate(fp); }} />
          </section>
        )}

        {tab === 'comments' && (
          <section role="tabpanel">
            <div className="add-comment-row" style={{ marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <textarea
                value={commentDraft}
                onChange={(e) => { setCommentDraft(e.target.value); }}
                placeholder={t('task.add_comment_placeholder', 'Add guidance for active or future agents…')}
                rows={3}
                disabled={addComment.isPending}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={addComment.isPending || commentDraft.trim().length === 0}
                  onClick={() => { addComment.mutate(commentDraft.trim()); }}
                >
                  {t('task.add_comment', 'Add comment')}
                </button>
              </div>
            </div>
            <ul className="comments">
              {[...comments].reverse().map((c: any) => (
                <li key={c.id} className={`comment author-${c.author_role}`}>
                  <div className="author">{t(`role.${c.author_role}`)}</div>
                  <pre>{c.body}</pre>
                </li>
              ))}
              {comments.length === 0 && <li className="muted">(no comments yet)</li>}
            </ul>
          </section>
        )}

        {tab === 'agent_runs' && (
          <section role="tabpanel">
            {(() => {
              const latest = (agent_runs ?? []).find((r: any) => r.status === 'running')
                ?? (agent_runs ?? [])[0];
              const latestId = latest?.id ?? null;
              return (
                <>
                  <details
                    className="phase-collapsible"
                    open={phaseOpen}
                    onToggle={(e) => { setPhaseOpen((e.target as HTMLDetailsElement).open); }}
                  >
                    <summary className="phase-collapsible-summary">
                      {t('task.phase_section', 'Phase & debt')}
                    </summary>
                    <PhaseTimeline runId={latestId} />
                    <DebtList runId={latestId} />
                  </details>
                </>
              );
            })()}
            <ul className="agent-runs-list">
              {(agent_runs ?? []).map((run: any) => (
                <li key={run.id} className={`agent-run status-${run.status}`}>
                  <div className="run-header">
                    <span className="role-badge">{run.role}</span>
                    <span className={`status-badge status-${run.status}`}>{run.status}</span>
                    {run.status === 'running' && run.started_at && (
                      <span className="elapsed-time">⏱ {formatElapsed(elapsedTimes[run.id] ?? 0)}</span>
                    )}
                    {(run.session_id ?? run.claude_session_id) && (
                      <ResumeRunButton
                        sessionId={run.session_id ?? run.claude_session_id}
                        repoPath={project?.repo_path}
                        provider={run.session_provider ?? task?.agent_provider_override ?? project?.agent_provider ?? 'claude'}
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

      {(() => {
        const hasActiveRun = (agent_runs ?? []).some(
          (r: any) => r.status === 'queued' || r.status === 'running'
        );
        const actions = (
          <>
            <div className="run-agent-wrap">
              <button
                type="button"
                className="icon-btn icon-btn-lg action-run"
                onClick={() => { setRunPickerOpen((v) => !v); }}
                disabled={runAgent.isPending || hasActiveRun}
                title={hasActiveRun ? t('task.run_agent_busy', 'Run already queued/active') : t('task.run_agent', 'Run Agent')}
                aria-label={t('task.run_agent', 'Run Agent')}
                aria-expanded={runPickerOpen}
              >
                <SvgIcon d="M5 3 L14 9 L5 15 Z" />
              </button>
              {runPickerOpen && (
                <div className="run-picker-pop" role="dialog">
                  <label className="run-picker-row">
                    <span>{t('task.run_agent_role', 'Role')}</span>
                    <select
                      value={runAgentRole}
                      onChange={(e) => { setRunAgentRole(e.target.value as 'pm' | 'worker' | 'reviewer'); }}
                    >
                      <option value="pm">{t('role.pm', 'PM')}</option>
                      <option value="worker">{t('role.worker', 'Worker')}</option>
                      <option value="reviewer">{t('role.reviewer', 'Reviewer')}</option>
                    </select>
                  </label>
                  <label className="run-picker-row">
                    <span>{t('task.run_agent_provider', 'Provider')}</span>
                    <select
                      value={runAgentProvider}
                      onChange={(e) => {
                        setRunAgentProvider(
                          e.target.value as 'default' | 'claude' | 'github_copilot' | 'codex' | 'council',
                        );
                      }}
                    >
                      <option value="default">{t('task.run_agent_provider_default', 'Role default')}</option>
                      <option value="claude">Claude</option>
                      <option value="github_copilot">Copilot</option>
                      <option value="codex">Codex</option>
                      <option value="council">{t('task.run_agent_provider_council', 'Council')}</option>
                    </select>
                  </label>
                  <div className="run-picker-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => { setRunPickerOpen(false); }}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        runAgent.mutate({ role: runAgentRole, providerChoice: runAgentProvider });
                        setRunPickerOpen(false);
                      }}
                      disabled={runAgent.isPending}
                    >
                      {t('task.run_agent', 'Run')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            {hasActiveRun && (
              <button
                type="button"
                className="icon-btn icon-btn-lg action-cancel"
                onClick={() => {
                  if (confirm(t('task.confirm_cancel_run', { defaultValue: 'Cancel active agent run?' }))) {
                    cancelRun.mutate();
                  }
                }}
                disabled={cancelRun.isPending}
                title={t('task.cancel_run', 'Cancel active agent')}
                aria-label={t('task.cancel_run', 'Cancel active agent')}
              >
                <SvgIcon d="M5 5 H13 V13 H5 Z" />
              </button>
            )}
            <CopyContextIconButton task={task} project={project} comments={comments} />
            <div className="action-spacer" />
            {task.status === 'human_approval' && (
              <>
                <button
                  type="button"
                  className="icon-btn icon-btn-lg action-approve"
                  onClick={() => { approve.mutate(); }}
                  title={t('task.approve')}
                  aria-label={t('task.approve')}
                >
                  <SvgIcon d="M3 9 L7 13 L15 4" />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-lg action-reject"
                  onClick={() => { setRejectOpen(true); }}
                  title={t('task.reject')}
                  aria-label={t('task.reject')}
                >
                  <SvgIcon d="M4 4 L14 14 M14 4 L4 14" />
                </button>
              </>
            )}
            <div className="action-delete-wrap">
              <button
                type="button"
                className="icon-btn icon-btn-lg action-delete"
                onClick={() => { setDeleteConfirmOpen((v) => !v); }}
                title={t('common.delete')}
                aria-label={t('common.delete')}
                aria-expanded={deleteConfirmOpen}
              >
                <SvgIcon d="M3 5 H15 M6 5 V3 A1 1 0 0 1 7 2 H11 A1 1 0 0 1 12 3 V5 M5 5 L6 15 A1 1 0 0 0 7 16 H11 A1 1 0 0 0 12 15 L13 5 M8 8 V13 M10 8 V13" />
              </button>
              {deleteConfirmOpen && (
                <div className="pop-confirm" role="dialog">
                  <p className="pop-confirm-msg">{t('common.confirm_delete', { code: task.code })}</p>
                  <div className="pop-confirm-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => { setDeleteConfirmOpen(false); }}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        del.mutate();
                        setDeleteConfirmOpen(false);
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        );
        return variant === 'drawer' ? (
          <footer className="detail-foot">
            <div className="actions compact">{actions}</div>
          </footer>
        ) : (
          <div className="detail-form-actions compact">{actions}</div>
        );
      })()}

      {rejectOpen && (
        <div className="modal-overlay" onClick={() => { setRejectOpen(false); }}>
          <div className="modal" onClick={e => { e.stopPropagation(); }}>
            <h2>{t('task.reject_title')}</h2>
            <textarea
              value={rejectMsg}
              onChange={e => { setRejectMsg(e.target.value); }}
              placeholder={t('task.reject_prompt')}
              rows={4}
              autoFocus
            />
            <label style={{ marginTop: '0.75rem', display: 'block' }}>
              {t('files.label', 'File paths')}
            </label>
            <FileDropZone paths={rejectFilePaths} onChange={setRejectFilePaths} />
            <div className="actions">
              <button className="ghost" onClick={() => { setRejectOpen(false); }}>
                {t('common.cancel')}
              </button>
              <button
                className="danger"
                disabled={rejectMsg.trim().length < 10 || reject.isPending}
                onClick={() => { reject.mutate(); }}
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
    valid.forEach(fp => { onAdd(fp); });
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
  sessionId, repoPath, provider = 'claude',
}: {
  sessionId: string;
  repoPath: string | null | undefined;
  provider?: 'claude' | 'github_copilot' | 'codex' | null;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const bin =
    provider === 'codex'
      ? 'codex resume'
      : provider === 'github_copilot'
        ? 'gh copilot -- --resume='
        : 'claude --resume';
  const cmd = repoPath
    ? `cd "${repoPath}"; ${provider === 'github_copilot' ? `${bin}${sessionId}` : `${bin} ${sessionId}`}`
    : `${provider === 'github_copilot' ? `${bin}${sessionId}` : `${bin} ${sessionId}`}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1400);
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

function CopyContextIconButton({
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
      setTimeout(() => { setCopied(false); }, 1800);
    } catch { /* clipboard blocked */ }
  }
  return (
    <button
      type="button"
      className={`icon-btn icon-btn-lg action-copy${copied ? ' is-copied' : ''}`}
      onClick={copy}
      title={copied ? t('common.copied', 'Copied') : t('task.copy_context', 'Copy context')}
      aria-label={t('task.copy_context', 'Copy context')}
    >
      {copied
        ? <SvgIcon d="M3 9 L7 13 L15 4" />
        : <SvgIcon d="M6 2 H11 L13 4 V11 H6 Z M4 5 V14 H11 M8 5 H11 M8 8 H11" />}
    </button>
  );
}

