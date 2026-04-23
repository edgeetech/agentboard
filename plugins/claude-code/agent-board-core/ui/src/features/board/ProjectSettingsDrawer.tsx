import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';

interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  workflow_type: 'WF1' | 'WF2';
  repo_path: string;
  auto_dispatch_pm: number;
  max_parallel: number;
  version: number;
}

export function ProjectSettingsDrawer({
  project, onClose,
}: { project: Project; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [name, setName]         = useState(project.name);
  const [description, setDesc]  = useState(project.description || '');
  const [repoPath, setRepoPath] = useState(project.repo_path);
  const [maxPar, setMaxPar]     = useState<number>(project.max_parallel);
  const [autoPm, setAutoPm]     = useState<boolean>(!!project.auto_dispatch_pm);
  const [saved, setSaved]       = useState<string | null>(null);

  // Reset on project change
  useEffect(() => {
    setName(project.name);
    setDesc(project.description || '');
    setRepoPath(project.repo_path);
    setMaxPar(project.max_parallel);
    setAutoPm(!!project.auto_dispatch_pm);
  }, [project.version]);

  const mut = useMutation({
    mutationFn: () => api.updateProject(project.code, {
      version: project.version,
      name: name.trim(),
      description: description.trim(),
      repo_path: repoPath.trim(),
      max_parallel: Number(maxPar),
      auto_dispatch_pm: autoPm ? 1 : 0,
    }),
    onSuccess: () => {
      setSaved(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['active-project'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setTimeout(() => setSaved(null), 2500);
    },
  });

  const dirty =
    name.trim() !== project.name ||
    description.trim() !== (project.description || '') ||
    repoPath.trim() !== project.repo_path ||
    Number(maxPar) !== project.max_parallel ||
    (autoPm ? 1 : 0) !== project.auto_dispatch_pm;

  return (
    <aside className="detail-panel settings-drawer">
      <div className="detail-head">
        <button onClick={onClose} title={t('common.close')}>×</button>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>{t('settings.title')}</h2>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (dirty) mut.mutate(); }}
        style={{ display: 'grid', gap: '.85rem', marginTop: '.5rem' }}
      >
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
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label>
          {t('settings.description')}
          <textarea
            value={description}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
          />
        </label>

        <label>
          {t('settings.repo_path')}
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            required
          />
          <small className="muted">{t('settings.repo_hint')}</small>
        </label>

        <label>
          {t('settings.max_parallel')}
          <input
            type="number"
            min={1}
            max={3}
            value={maxPar}
            onChange={(e) => setMaxPar(parseInt(e.target.value, 10) || 1)}
          />
          <small className="muted">{t('settings.max_parallel_hint')}</small>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <input
            type="checkbox"
            checked={autoPm}
            onChange={(e) => setAutoPm(e.target.checked)}
          />
          <span>{t('settings.auto_dispatch_pm')}</span>
        </label>

        <div className="actions" style={{ marginTop: '.5rem' }}>
          <button type="button" onClick={onClose}>{t('common.close')}</button>
          <button
            type="submit"
            className="primary"
            disabled={!dirty || mut.isPending || !name.trim() || !repoPath.trim()}
          >
            {t('common.save')}
          </button>
        </div>

        {saved && <div className="muted" role="status">{saved}</div>}
        {mut.isError && <div className="err">{(mut.error as Error).message}</div>}
      </form>
    </aside>
  );
}
