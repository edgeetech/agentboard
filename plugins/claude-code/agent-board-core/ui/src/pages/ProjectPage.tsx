import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { AgentProviderIcon } from '../components/AgentProviderIcon';

export function ProjectPage() {
  const { t } = useTranslation();
  const { projectCode } = useParams<{ projectCode: string }>();
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
  const [maxPar, setMaxPar] = useState<number>(1);
  const [autoPm, setAutoPm] = useState<boolean>(false);
  const [agentProvider, setAgentProvider] = useState<'claude' | 'github_copilot'>('claude');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDesc(project.description || '');
    setRepoPath(project.repo_path);
    setMaxPar(project.max_parallel);
    setAutoPm(!!project.auto_dispatch_pm);
    setAgentProvider(project.agent_provider || 'claude');
  }, [project?.version]);

  const mut = useMutation({
    mutationFn: () => project
      ? api.updateProject(project.code, {
          version: project.version,
          name: name.trim(),
          description: description.trim(),
          repo_path: repoPath.trim(),
          max_parallel: Number(maxPar),
          auto_dispatch_pm: autoPm ? 1 : 0,
          agent_provider: agentProvider,
        })
      : Promise.reject(new Error('no project')),
    onSuccess: () => {
      setSaved(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['active-project'] });
      qc.invalidateQueries({ queryKey: ['projects-list'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setTimeout(() => setSaved(null), 2500);
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

  const dirty =
    name.trim() !== project.name ||
    description.trim() !== (project.description || '') ||
    repoPath.trim() !== project.repo_path ||
    Number(maxPar) !== project.max_parallel ||
    (autoPm ? 1 : 0) !== project.auto_dispatch_pm ||
    agentProvider !== (project.agent_provider || 'claude');

  return (
    <>
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
        className="form-card"
        onSubmit={(e) => { e.preventDefault(); if (dirty) mut.mutate(); }}
      >
        <div className="form-grid">
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
            <input value={name} onChange={e => setName(e.target.value)} required />
          </label>
          <label>
            {t('settings.description')}
            <textarea value={description} onChange={e => setDesc(e.target.value)} rows={3} />
          </label>
          <label>
            {t('settings.repo_path')}
            <input value={repoPath} onChange={e => setRepoPath(e.target.value)} required />
            <small className="muted">{t('settings.repo_hint')}</small>
          </label>
          <label>
            {t('settings.max_parallel')}
            <input
              type="number" min={1} max={3}
              value={maxPar}
              onChange={e => setMaxPar(parseInt(e.target.value, 10) || 1)}
            />
            <small className="muted">{t('settings.max_parallel_hint')}</small>
          </label>
           <fieldset>
             <legend>{t('settings.agent_provider')}</legend>
             <small className="muted">{t('settings.agent_provider_hint')}</small>
             <div className="agent-provider-toggle">
               <button
                 type="button"
                 className={`agent-toggle-item ${agentProvider === 'claude' ? 'active' : ''}`}
                 onClick={() => setAgentProvider('claude')}
                 title="Claude (Anthropic SDK)"
               >
                 <AgentProviderIcon provider="claude" size="lg" tooltip={false} />
               </button>
               <button
                 type="button"
                 className={`agent-toggle-item ${agentProvider === 'github_copilot' ? 'active' : ''}`}
                 onClick={() => setAgentProvider('github_copilot')}
                 title="GitHub Copilot"
               >
                 <AgentProviderIcon provider="github_copilot" size="lg" tooltip={false} />
               </button>
             </div>
           </fieldset>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={autoPm}
              onChange={e => setAutoPm(e.target.checked)}
            />
            <span>{t('settings.auto_dispatch_pm')}</span>
          </label>

          <div className="form-actions">
            <button
              type="submit"
              className="primary"
              disabled={!dirty || mut.isPending || !name.trim() || !repoPath.trim()}
            >
              {t('common.save')}
            </button>
            {saved && <span className="muted" role="status">{saved}</span>}
          </div>
          {mut.isError && <div className="err">{(mut.error as Error).message}</div>}
        </div>
      </form>
    </>
  );
}
