import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getRole, upsertRole, loadSkills, Role } from '../data/catalog';
import { PromptPanel } from '../components/PromptPanel';

export function RoleDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const existing = getRole(id);
  const allSkills = useMemo(loadSkills, []);

  const [name, setName] = useState(existing?.name ?? '');
  const [emblem, setEmblem] = useState(existing?.emblem ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [skills, setSkills] = useState<string[]>(existing?.skills ?? []);
  const [saved, setSaved] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(true);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setEmblem(existing.emblem);
    setDescription(existing.description);
    setSkills(existing.skills);
  }, [id]);

  if (!existing) {
    return (
      <div className="empty-state">
        <h3>{t('common.not_found', 'Not found')}</h3>
        <p>No role with id <code>{id}</code>.</p>
        <p><Link to="/roles">{t('common.back', '← Back')}</Link></p>
      </div>
    );
  }

  const dirty =
    name !== existing.name ||
    emblem !== existing.emblem ||
    description !== existing.description ||
    skills.join('|') !== existing.skills.join('|');

  function toggleSkill(sid: string) {
    setSkills(prev => prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]);
  }
  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    const next: Role = {
      id: existing!.id,
      name: name.trim(),
      emblem: emblem.trim().slice(0, 3).toUpperCase(),
      description: description.trim(),
      skills,
    };
    upsertRole(next);
    setSaved(t('common.saved'));
    setTimeout(() => setSaved(null), 2500);
  }

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>
            {existing.name} <span className="code">role · {existing.id}</span>
          </h1>
          <span className="subtitle">
            {t('roles.detail_subtitle', 'Edit this agent persona and the skills it is allowed to use.')}
          </span>
        </div>
        <div className="actions">
          {!promptOpen && (
            <button className="ghost" type="button" onClick={() => setPromptOpen(true)}>
              {t('prompt.show', 'Show prompt')}
            </button>
          )}
          <Link to="/roles"><button className="ghost" type="button">← {t('roles.title', 'Roles')}</button></Link>
        </div>
      </div>

      <div className={'detail-with-aside' + (promptOpen ? '' : ' no-aside')}>
      <form className="form-card" onSubmit={onSave}>
        <div className="form-grid">
          <label>
            {t('roles.name', 'Name')}
            <input value={name} onChange={e => setName(e.target.value)} required />
          </label>
          <label>
            {t('roles.emblem', 'Emblem')}
            <input value={emblem} onChange={e => setEmblem(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
          </label>
          <label>
            {t('roles.description', 'Description')}
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
          </label>

          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
              {t('roles.skills', 'Skills')}
            </div>
            <div className="skill-picker">
              {allSkills.map(s => {
                const active = skills.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={'skill-pick' + (active ? ' active' : '')}
                    onClick={() => toggleSkill(s.id)}
                  >
                    <span className="e">{s.emblem}</span>
                    <span className="n">{s.name}</span>
                  </button>
                );
              })}
            </div>
            <small className="muted">
              {t('roles.skills_hint', 'Tap to toggle. These appear on the role card and influence dispatch.')}
            </small>
          </div>

          <div className="form-actions">
            <button type="submit" className="primary" disabled={!dirty || !name.trim()}>
              {t('common.save')}
            </button>
            {saved && <span className="muted" role="status">{saved}</span>}
          </div>
          <small className="muted">
            {t('catalog.local_note', 'Stored locally in this browser until the server adds a catalog API.')}
          </small>
        </div>
      </form>
      {promptOpen && <PromptPanel kind="role" id={existing.id} onClose={() => setPromptOpen(false)} />}
      </div>
    </>
  );
}
