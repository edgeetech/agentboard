import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

export function SetupWizard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [workflow, setWorkflow] = useState<'WF1' | 'WF2'>('WF1');
  const [repoPath, setRepoPath] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [userEditedCode, setUserEditedCode] = useState(false);

  // Auto-suggest code as user types name (until they edit it)
  useEffect(() => {
    if (userEditedCode || !name) return;
    const id = setTimeout(async () => {
      try { setCode((await api.suggestCode(name)).code); } catch {}
    }, 200);
    return () => clearTimeout(id);
  }, [name, userEditedCode]);

  const create = useMutation({
    mutationFn: () => api.createProject({
      code, name, description, workflow_type: workflow, repo_path: repoPath,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['active-project'] }),
    onError: (e: Error) => setErr(e.message),
  });

  const codeOk = /^[A-Z0-9]{2,7}$/.test(code);

  return (
    <div className="wizard">
      <h1>{t('wizard.header')}</h1>
      <form onSubmit={e => { e.preventDefault(); setErr(null); create.mutate(); }}>
        <label>{t('wizard.name')}
          <input value={name} onChange={e => setName(e.target.value)} required autoFocus />
        </label>
        <label>{t('wizard.description')}
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        </label>
        <label>{t('wizard.code')}
          <input
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setUserEditedCode(true); }}
            maxLength={7}
            required
            aria-invalid={!codeOk}
          />
          <small>{t('wizard.code_hint', { code: code || 'ABC' })}</small>
        </label>
        <label>{t('wizard.workflow')}
          <select value={workflow} onChange={e => setWorkflow(e.target.value as 'WF1' | 'WF2')}>
            <option value="WF1">{t('wizard.wf1')}</option>
            <option value="WF2">{t('wizard.wf2')}</option>
          </select>
        </label>
        <label>{t('wizard.repo_path')}
          <input value={repoPath} onChange={e => setRepoPath(e.target.value)} required
                 placeholder="C:/path/to/repo" />
          <small>{t('wizard.repo_hint')}</small>
        </label>
        <button type="submit" disabled={!codeOk || !name || !repoPath || create.isPending}>
          {t('wizard.create')}
        </button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
