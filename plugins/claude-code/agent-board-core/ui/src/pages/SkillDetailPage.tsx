import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSkill, upsertSkill, Skill } from '../data/catalog';
import { PromptPanel } from '../components/PromptPanel';

export function SkillDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const existing = getSkill(id);

  const [name, setName] = useState(existing?.name ?? '');
  const [emblem, setEmblem] = useState(existing?.emblem ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [tagsText, setTagsText] = useState((existing?.tags ?? []).join(', '));
  const [saved, setSaved] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(true);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setEmblem(existing.emblem);
    setDescription(existing.description);
    setTagsText(existing.tags.join(', '));
  }, [id]);

  if (!existing) {
    return (
      <div className="empty-state">
        <h3>{t('common.not_found', 'Not found')}</h3>
        <p>No skill with id <code>{id}</code>.</p>
        <p><Link to="/skills">{t('common.back', '← Back')}</Link></p>
      </div>
    );
  }

  const tags = tagsText.split(',').map(s => s.trim()).filter(Boolean);
  const dirty =
    name !== existing.name ||
    emblem !== existing.emblem ||
    description !== existing.description ||
    tags.join('|') !== existing.tags.join('|');

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    const next: Skill = { id: existing!.id, name: name.trim(), emblem: emblem.trim().slice(0, 3).toUpperCase(), description: description.trim(), tags };
    upsertSkill(next);
    setSaved(t('common.saved'));
    setTimeout(() => setSaved(null), 2500);
  }

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>
            {existing.name} <span className="code">skill · {existing.id}</span>
          </h1>
          <span className="subtitle">
            {t('skills.detail_subtitle', 'Edit how this skill shows up when attached to a role or run.')}
          </span>
        </div>
        <div className="actions">
          {!promptOpen && (
            <button className="ghost" type="button" onClick={() => setPromptOpen(true)}>
              {t('prompt.show', 'Show prompt')}
            </button>
          )}
          <Link to="/skills"><button className="ghost" type="button">← {t('skills.title', 'Skills')}</button></Link>
        </div>
      </div>

      <div className={'detail-with-aside' + (promptOpen ? '' : ' no-aside')}>
      <form className="form-card" onSubmit={onSave}>
        <div className="entity-card-preview" aria-hidden>
          <div className="emblem">{emblem || '··'}</div>
          <div>
            <strong>{name || t('common.untitled', 'Untitled')}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{description || '—'}</div>
          </div>
        </div>

        <div className="form-grid">
          <label>
            {t('skills.name', 'Name')}
            <input value={name} onChange={e => setName(e.target.value)} required />
          </label>
          <label>
            {t('skills.emblem', 'Emblem')}
            <input value={emblem} onChange={e => setEmblem(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
            <small className="muted">{t('skills.emblem_hint', '1–3 character monogram shown on the card.')}</small>
          </label>
          <label>
            {t('skills.description', 'Description')}
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
          </label>
          <label>
            {t('skills.tags', 'Tags')}
            <input value={tagsText} onChange={e => setTagsText(e.target.value)} />
            <small className="muted">{t('skills.tags_hint', 'Comma-separated — e.g. reviewer, pytest, default.')}</small>
          </label>

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
      {promptOpen && <PromptPanel kind="skill" id={existing.id} onClose={() => setPromptOpen(false)} />}
      </div>
    </>
  );
}
