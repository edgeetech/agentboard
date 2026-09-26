import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { api, parseAuthConfig, setProjectCode } from '../api';
import type { AgentConfig, AgentProvider, AuthConfig } from '../api';
import { AgentConfigEditor } from '../components/AgentConfigEditor';
import { AuthModeEditor } from '../components/AuthModeEditor';
import { rememberLastProject } from '../hooks/useCurrentProjectCode';

function parseProjectAgentConfig(raw: unknown): AgentConfig {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    if (raw.trim() === '') return {};
    try {
      const v = JSON.parse(raw) as AgentConfig;
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as AgentConfig;
  return {};
}

export function ProjectPage() {
  const { t } = useTranslation();
  const { projectCode } = useParams<{ projectCode: string }>();
  const navigate = useNavigate();
  const projUpper = projectCode ? projectCode.toUpperCase() : null;
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects });
  const active = useQuery({
    queryKey: ['active-project'],
    queryFn: api.activeProject,
    enabled: !projUpper,
  });
  const project = projUpper
    ? (list.data?.projects.find((p: any) => p.code === projUpper) || null)
    : active.data?.project;

  const [name, setName] = useState('');
  const [description, setDesc] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [maxPar, setMaxPar] = useState<number>(2);
  const [agentProvider, setAgentProvider] = useState<AgentProvider>('claude');
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({});
  const [authConfig, setAuthConfig] = useState<AuthConfig>({});
  const [scanIgnore, setScanIgnore] = useState<string[]>([]);
  const [scanIgnoreText, setScanIgnoreText] = useState('');
  const [trackerKind, setTrackerKind] = useState<'linear' | 'github' | 'gitlab'>('github');
  const [trackerEndpoint, setTrackerEndpoint] = useState('');
  const [trackerEnv, setTrackerEnv] = useState('');
  const [trackerSlug, setTrackerSlug] = useState('');
  const [trackerActiveStates, setTrackerActiveStates] = useState('Todo\nIn Progress');
  const [trackerTerminalStates, setTrackerTerminalStates] = useState(
    'Done\nCancelled\nCanceled\nDuplicate',
  );
  const [trackerAssignee, setTrackerAssignee] = useState('');
  const [trackerInterval, setTrackerInterval] = useState(30_000);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const trackerQ = useQuery({
    queryKey: ['tracker', project?.code],
    // Guarded by `enabled: !!project` — queryFn only ever runs once project exists.
    queryFn: () => api.projectTracker(project!.code),
    enabled: !!project,
    refetchInterval: 15_000,
  });
  const doctorQ = useQuery({
    queryKey: ['doctor', project?.code],
    queryFn: () => api.projectDoctor(project!.code),
    enabled: !!project,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDesc(project.description || '');
    setRepoPath(project.repo_path);
    setMaxPar(project.max_parallel);
    setAgentProvider(project.agent_provider || 'claude');
    setAgentConfig(parseProjectAgentConfig(project.agent_config_json));
    setAuthConfig(parseAuthConfig(project.auth_config_json));
    const ig: string[] = Array.isArray(project.scan_ignore_json) ? project.scan_ignore_json : [];
    setScanIgnore(ig);
    setScanIgnoreText(ig.join('\n'));
  }, [project?.version]);

  useEffect(() => {
    const tracker = trackerQ.data?.tracker;
    if (!tracker) {
      // Switching to a project with no tracker configured — clear the form
      // instead of leaving the previous project's values in place (which
      // would silently create a copy of them on Save).
      setTrackerKind('github');
      setTrackerEndpoint('');
      setTrackerEnv('');
      setTrackerSlug('');
      setTrackerActiveStates('Todo\nIn Progress');
      setTrackerTerminalStates('Done\nCancelled\nCanceled\nDuplicate');
      setTrackerAssignee('');
      setTrackerInterval(30_000);
      return;
    }
    setTrackerKind(tracker.kind);
    setTrackerEndpoint(tracker.endpoint ?? '');
    setTrackerEnv(tracker.api_key_env_var);
    setTrackerSlug(tracker.project_slug);
    setTrackerActiveStates((tracker.active_states ?? []).join('\n'));
    setTrackerTerminalStates((tracker.terminal_states ?? []).join('\n'));
    setTrackerAssignee(tracker.assignee ?? '');
    setTrackerInterval(tracker.poll_interval_ms);
  }, [project?.code, trackerQ.data?.tracker?.updated_at]);

  const mut = useMutation({
    mutationFn: () => project
      ? api.updateProject(project.code, {
          version: project.version,
          name: name.trim(),
          description: description.trim(),
          repo_path: repoPath.trim(),
          max_parallel: Number(maxPar),
          agent_provider: agentProvider,
          agent_config_json: Object.keys(agentConfig).length > 0 ? agentConfig : null,
          auth_config_json: Object.keys(authConfig).length > 0 ? authConfig : null,
          scan_ignore_json: scanIgnore,
        })
      : Promise.reject(new Error('no project')),
    onSuccess: () => {
      setSaved(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['active-project'] });
      qc.invalidateQueries({ queryKey: ['projects-list'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setTimeout(() => { setSaved(null); }, 2500);
    },
  });

  const saveTracker = useMutation({
    mutationFn: () =>
      project
        ? api.saveProjectTracker(project.code, {
            kind: trackerKind,
            endpoint: trackerEndpoint.trim() || null,
            api_key_env_var: trackerEnv.trim(),
            project_slug: trackerSlug.trim(),
            active_states: lines(trackerActiveStates),
            terminal_states: lines(trackerTerminalStates),
            assignee: trackerAssignee.trim() || null,
            poll_interval_ms: Number(trackerInterval),
          })
        : Promise.reject(new Error('no project')),
    onSuccess: () => {
      if (!project) return;
      qc.invalidateQueries({ queryKey: ['tracker', project.code] });
      qc.invalidateQueries({ queryKey: ['health-summary', project.code] });
    },
  });
  const enableTracker = useMutation({
    mutationFn: () =>
      project ? api.enableProjectTracker(project.code) : Promise.reject(new Error('no project')),
    onSuccess: () => {
      if (!project) return;
      qc.invalidateQueries({ queryKey: ['tracker', project.code] });
      qc.invalidateQueries({ queryKey: ['health-summary', project.code] });
    },
  });
  const disableTracker = useMutation({
    mutationFn: () =>
      project ? api.disableProjectTracker(project.code) : Promise.reject(new Error('no project')),
    onSuccess: () => {
      if (!project) return;
      qc.invalidateQueries({ queryKey: ['tracker', project.code] });
      qc.invalidateQueries({ queryKey: ['health-summary', project.code] });
    },
  });
  const syncTracker = useMutation({
    mutationFn: () =>
      project ? api.syncProjectTracker(project.code) : Promise.reject(new Error('no project')),
    onSuccess: () => {
      if (!project) return;
      qc.invalidateQueries({ queryKey: ['tracker', project.code] });
      qc.invalidateQueries({ queryKey: ['health-summary', project.code] });
    },
  });
  const deleteMut = useMutation({
    mutationFn: () => project
      ? api.deleteProject(project.code)
      : Promise.reject(new Error('no project')),
    onSuccess: async () => {
      rememberLastProject(null);
      setProjectCode(null);
      qc.removeQueries({ queryKey: ['tasks'] });
      qc.removeQueries({ queryKey: ['task'] });
      qc.removeQueries({ queryKey: ['board'] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['active-project'] }),
        qc.invalidateQueries({ queryKey: ['projects-list'] }),
      ]);
      navigate('/', { replace: true });
    },
  });

  if (list.isLoading || (!projUpper && active.isLoading)) return <div className="center"><div className="spinner" /></div>;
  if (!project) {
    return (
      <div className="empty-state">
        <h3>{t('project.none_title', 'No active project')}</h3>
        <p>{t('project.none_body', 'Create a project from the Board page first.')}</p>
      </div>
    );
  }

  const projectScanIgnore: string[] = Array.isArray(project.scan_ignore_json)
    ? project.scan_ignore_json
    : [];
  const projectAgentConfig = parseProjectAgentConfig(project.agent_config_json);
  const dirty =
    name.trim() !== project.name ||
    description.trim() !== (project.description || '') ||
    repoPath.trim() !== project.repo_path ||
    Number(maxPar) !== project.max_parallel ||
    agentProvider !== (project.agent_provider || 'claude') ||
    JSON.stringify(agentConfig) !== JSON.stringify(projectAgentConfig) ||
    JSON.stringify(authConfig) !== JSON.stringify(parseAuthConfig(project.auth_config_json)) ||
    scanIgnore.join('\n') !== projectScanIgnore.join('\n');

  return (
    <div className="project-page">
      <div className="page-head">
        <div className="title">
          <h1>
            {t('project.title', 'Project')}{' '}
            <span className="code">{project.code}</span>
          </h1>
          <span className="subtitle">
            {t('project.subtitle', 'Settings, repo path, and dispatch limits.')}
          </span>
        </div>
      </div>

      <form
        className="form-card project-form"
        onSubmit={(e) => { e.preventDefault(); if (dirty) mut.mutate(); }}
      >
        <div className="project-form-scroll">
          <div className="form-grid project-form-grid">
            <label>
              {t('settings.code')}
              <input value={project.code} disabled />
              <small className="muted">{t('settings.code_locked')}</small>
            </label>
            <label>
              {t('settings.workflow')}
              <input value={project.workflow_type} disabled />
              <small className="muted">{t('settings.workflow_locked')}</small>
            </label>
            <label>
              {t('settings.name')}
              <input value={name} onChange={e => { setName(e.target.value); }} required />
            </label>
            <label className="project-field-wide">
              {t('settings.description')}
              <textarea value={description} onChange={e => { setDesc(e.target.value); }} rows={3} />
            </label>
            <label className="project-field-wide">
              {t('settings.repo_path')}
              <input value={repoPath} onChange={e => { setRepoPath(e.target.value); }} required />
              <small className="muted">{t('settings.repo_hint')}</small>
            </label>
            <label>
              {t('settings.max_parallel')}
              <input
                type="number" min={1} max={3}
                value={maxPar}
                onChange={e => { setMaxPar(parseInt(e.target.value, 10) || 1); }}
              />
              <small className="muted">{t('settings.max_parallel_hint')}</small>
            </label>
            <fieldset className="project-field-wide">
              <legend>{t('settings.agent_config', 'Agent configuration')}</legend>
              <AgentConfigEditor
                value={agentConfig}
                onChange={setAgentConfig}
                fallbackProvider={agentProvider}
              />
            </fieldset>
            <fieldset className="project-field-wide">
              <legend>{t('auth.title', 'Sign-in & billing')}</legend>
              <AuthModeEditor value={authConfig} onChange={setAuthConfig} />
            </fieldset>
            <label className="project-field-wide">
              {t('settings.scan_ignore', 'Skip these folders')}
              <textarea
                value={scanIgnoreText}
                onChange={e => {
                  const v = e.target.value;
                  setScanIgnoreText(v);
                  setScanIgnore(
                    v.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')),
                  );
                }}
                placeholder={'legacy\nTax/__archived_maintenance\n# comments are ok'}
                rows={5}
              />
              <small className="muted">{t('settings.scan_ignore_hint')}</small>
            </label>
          </div>
          <section className="project-danger-zone" aria-labelledby="delete-project-title">
            <div>
              <h2 id="delete-project-title">
                {t('project.delete_title', 'Delete Project')}
              </h2>
              <p>
                {t(
                  'project.delete_warning',
                  'Remove this project and its AgentBoard tasks and sessions. The repository directory and its contents will not be changed.',
                )}
              </p>
            </div>
            {!deleteConfirmOpen ? (
              <button
                type="button"
                className="danger"
                onClick={() => {
                  deleteMut.reset();
                  setDeleteConfirmOpen(true);
                }}
              >
                {t('project.delete_action', 'Delete Project')}
              </button>
            ) : (
              <div className="project-delete-confirm" role="group" aria-labelledby="delete-project-title">
                <label htmlFor="project-delete-confirmation">
                  {t('project.delete_confirm', 'Type “{{name}}” to confirm deletion.', {
                    name: project.name,
                  })}
                </label>
                <input
                  id="project-delete-confirmation"
                  value={deleteConfirmation}
                  onChange={(event) => { setDeleteConfirmation(event.target.value); }}
                  autoComplete="off"
                  autoFocus
                />
                <div className="project-delete-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirmOpen(false);
                      setDeleteConfirmation('');
                      deleteMut.reset();
                    }}
                    disabled={deleteMut.isPending}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={deleteConfirmation !== project.name || deleteMut.isPending}
                    onClick={() => { deleteMut.mutate(); }}
                  >
                    {deleteMut.isPending
                      ? t('project.deleting', 'Deleting…')
                      : t('project.delete_confirm_action', 'Permanently delete project')}
                  </button>
                </div>
                {deleteMut.isError && (
                  <div className="err" role="alert">{deleteMut.error.message}</div>
                )}
              </div>
            )}
          </section>
        </div>
        <div className="form-actions project-form-actions">
          <button
            type="submit"
            className="primary"
            disabled={!dirty || mut.isPending || !name.trim() || !repoPath.trim()}
          >
            {t('common.save')}
          </button>
          {saved && <span className="muted" role="status">{saved}</span>}
          {mut.isError && <div className="err">{(mut.error).message}</div>}
        </div>
      </form>

      <section className="form-card project-form">
        <div className="project-form-scroll">
          <div className="form-grid project-form-grid">
            <label>
              {t('project.tracker_kind', 'Tracker')}
              <select
                value={trackerKind}
                onChange={(e) => {
                  setTrackerKind(e.target.value as 'linear' | 'github' | 'gitlab');
                }}
              >
                <option value="github">GitHub</option>
                <option value="linear">Linear</option>
                <option value="gitlab">GitLab</option>
              </select>
            </label>
            <label>
              {t('project.tracker_slug', 'Project slug')}
              <input
                value={trackerSlug}
                onChange={(e) => { setTrackerSlug(e.target.value); }}
                placeholder="owner/repo or team/project"
              />
            </label>
            <label>
              {t('project.tracker_env', 'API key env var')}
              <input
                value={trackerEnv}
                onChange={(e) => { setTrackerEnv(e.target.value); }}
                placeholder="AGENTBOARD_TRACKER_TOKEN"
              />
            </label>
            <label>
              {t('project.tracker_endpoint', 'Endpoint')}
              <input
                value={trackerEndpoint}
                onChange={(e) => { setTrackerEndpoint(e.target.value); }}
                placeholder={t('common.optional', 'optional')}
              />
            </label>
            <label>
              {t('project.tracker_interval', 'Poll interval ms')}
              <input
                type="number"
                min={5000}
                max={86400000}
                value={trackerInterval}
                onChange={(e) => { setTrackerInterval(parseInt(e.target.value, 10) || 30000); }}
              />
            </label>
            <label>
              {t('project.tracker_assignee', 'Assignee')}
              <input
                value={trackerAssignee}
                onChange={(e) => { setTrackerAssignee(e.target.value); }}
                placeholder={t('common.optional', 'optional')}
              />
            </label>
            <label>
              {t('project.tracker_active_states', 'Active states')}
              <textarea
                value={trackerActiveStates}
                onChange={(e) => { setTrackerActiveStates(e.target.value); }}
                rows={4}
              />
            </label>
            <label>
              {t('project.tracker_terminal_states', 'Terminal states')}
              <textarea
                value={trackerTerminalStates}
                onChange={(e) => { setTrackerTerminalStates(e.target.value); }}
                rows={4}
              />
            </label>
          </div>
          <TrackerStatusPanel data={trackerQ.data} />
        </div>
        <div className="form-actions project-section-actions">
          <button
            className="primary"
            type="button"
            disabled={saveTracker.isPending || !trackerEnv.trim() || !trackerSlug.trim()}
            onClick={() => { saveTracker.mutate(); }}
          >
            {t('project.tracker_save', 'Save tracker')}
          </button>
          <button
            className="ghost"
            type="button"
            disabled={enableTracker.isPending || !trackerQ.data?.tracker}
            onClick={() => { enableTracker.mutate(); }}
          >
            {t('project.tracker_enable', 'Enable')}
          </button>
          <button
            className="ghost"
            type="button"
            disabled={disableTracker.isPending || !trackerQ.data?.tracker}
            onClick={() => { disableTracker.mutate(); }}
          >
            {t('project.tracker_disable', 'Disable')}
          </button>
          <button
            className="ghost"
            type="button"
            disabled={syncTracker.isPending || !trackerQ.data?.tracker}
            onClick={() => { syncTracker.mutate(); }}
          >
            {t('project.tracker_sync', 'Sync now')}
          </button>
          {(saveTracker.isError ||
            enableTracker.isError ||
            disableTracker.isError ||
            syncTracker.isError) && (
            <div className="err">
              {
                (saveTracker.error ??
                  enableTracker.error ??
                  disableTracker.error ??
                  syncTracker.error)?.message
              }
            </div>
          )}
        </div>
      </section>

      <section className="form-card project-form">
        <div className="project-form-scroll">
          <h2>{t('project.doctor_title', 'Doctor')}</h2>
          <div className="doctor-list">
            {(doctorQ.data?.checks ?? []).map((check) => (
              <div key={check.id} className={`doctor-check doctor-${check.status}`}>
                <strong>{check.label}</strong>
                <span>{check.status}</span>
                <p>{check.detail}</p>
                {check.action && <small>{check.action}</small>}
              </div>
            ))}
            {doctorQ.isLoading && <div className="muted">{t('project.doctor_checking', 'Checking setup…')}</div>}
            {doctorQ.isError && <div className="err">{doctorQ.error.message}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function TrackerStatusPanel({ data }: { data?: Awaited<ReturnType<typeof api.projectTracker>> }) {
  const { t } = useTranslation();
  const status = data?.status;
  if (!status) return <div className="muted">{t('project.tracker_no_status', 'No tracker status yet.')}</div>;
  const yes = t('common.yes', 'yes');
  const no = t('common.no', 'no');
  return (
    <div className="tracker-status-grid">
      <StatusCell label={t('project.tracker_enabled', 'Enabled')} value={status.enabled ? yes : no} />
      <StatusCell
        label={t('project.tracker_env_present', 'Env present')}
        value={status.env_present ? yes : no}
        tone={status.env_present ? 'ok' : 'bad'}
      />
      <StatusCell label={t('project.tracker_issues', 'Issues')} value={String(status.issues_count)} />
      <StatusCell label={t('project.tracker_last_poll', 'Last poll')} value={status.last_poll_at ?? '-'} />
      <StatusCell label={t('project.tracker_last_success', 'Last success')} value={status.last_success_at ?? '-'} />
      <StatusCell label={t('project.tracker_next_poll', 'Next poll')} value={status.next_poll_at ?? '-'} />
      <StatusCell
        label={t('project.tracker_rate_limited', 'Rate limited')}
        value={status.rate_limited ? yes : no}
        tone={status.rate_limited ? 'warn' : 'ok'}
      />
      <StatusCell
        label={t('project.tracker_last_error', 'Last error')}
        value={status.last_error ?? '-'}
        tone={status.last_error ? 'bad' : 'ok'}
      />
    </div>
  );
}

function StatusCell({
  label,
  value,
  tone = 'ok',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className={`status-cell status-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
