import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api';
import { CopyIcon } from '../components/CopyIcon';

export function SkillDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();

  const skillQ = useQuery({
    queryKey: ['skill', id],
    queryFn: () => api.getSkill(id),
    enabled: !!id,
  });
  const existing = skillQ.data?.skill;

  const [name, setName] = useState('');
  const [emblem, setEmblem] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [allowedToolsText, setAllowedToolsText] = useState('');
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [bodyOpen, setBodyOpen] = useState(true);
  const [bodyEditing, setBodyEditing] = useState(false);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setEmblem(existing.emblem);
    setDescription(existing.description);
    setTagsText(existing.tags.join(', '));
    setAllowedToolsText(existing.allowedTools.join(', '));
    setBody(existing.body);
  }, [existing?.id, existing?.scannedAt]);

  const update = useMutation({
    mutationFn: (patch: {
      name: string;
      description: string;
      emblem: string;
      tags: string[];
      allowedTools: string[];
      body: string;
    }) => api.updateSkill(id, patch),
    onSuccess: () => {
      setSaved(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['skill', id] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      setTimeout(() => { setSaved(null); }, 2500);
    },
  });

  if (skillQ.isLoading) {
    return <div className="center"><div className="spinner" /></div>;
  }
  if (skillQ.isError || !existing) {
    return (
      <div className="empty-state">
        <h3>{t('common.not_found', 'Not found')}</h3>
        <p>No skill with id <code>{id}</code>.</p>
        <p><Link to="/skills">{t('common.back', '← Back')}</Link></p>
      </div>
    );
  }

  const isBuiltin = existing.id.startsWith('builtin:');
  const tags = tagsText.split(',').map(s => s.trim()).filter(Boolean);
  const allowedTools = allowedToolsText.split(',').map(s => s.trim()).filter(Boolean);
  const dirty =
    name !== existing.name ||
    emblem !== existing.emblem ||
    description !== existing.description ||
    body !== existing.body ||
    tags.join('|') !== existing.tags.join('|') ||
    allowedTools.join('|') !== existing.allowedTools.join('|');

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || !existing) return;
    update.mutate({
      name: name.trim(),
      emblem: emblem.trim().slice(0, 3).toUpperCase(),
      description: description.trim(),
      tags,
      allowedTools,
      body,
    });
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
          {!bodyOpen && (
            <button className="ghost" type="button" onClick={() => { setBodyOpen(true); }}>
              {t('prompt.show', 'Show prompt')}
            </button>
          )}
          <Link to="/skills">
            <button className="ghost" type="button">← {t('skills.title', 'Skills')}</button>
          </Link>
        </div>
      </div>

      <div className={'detail-with-aside' + (bodyOpen ? '' : ' no-aside')}>
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
            <input value={name} onChange={e => { setName(e.target.value); }} required disabled={isBuiltin} />
          </label>
          <label>
            {t('skills.emblem', 'Emblem')}
            <input
              value={emblem}
              onChange={e => { setEmblem(e.target.value.toUpperCase().slice(0, 3)); }}
              maxLength={3}
              disabled={isBuiltin}
            />
            <small className="muted">{t('skills.emblem_hint', '1–3 character monogram shown on the card.')}</small>
          </label>
          <label>
            {t('skills.description', 'Description')}
            <textarea value={description} onChange={e => { setDescription(e.target.value); }} rows={4} disabled={isBuiltin} />
          </label>
          <label>
            {t('skills.tags', 'Tags')}
            <input value={tagsText} onChange={e => { setTagsText(e.target.value); }} disabled={isBuiltin} />
            <small className="muted">{t('skills.tags_hint', 'Comma-separated — e.g. reviewer, pytest, default.')}</small>
          </label>
          <label>
            {t('skills.allowed_tools', 'Allowed tools')}
            <input value={allowedToolsText} onChange={e => { setAllowedToolsText(e.target.value); }} disabled={isBuiltin} />
            <small className="muted">
              {t('skills.allowed_tools_hint', 'Comma-separated tool names from the SKILL.md frontmatter.')}
            </small>
          </label>
          <div>
            <span className="tag" title={existing.absPath}>{existing.absPath}</span>
          </div>

          <div className="form-actions">
            {isBuiltin ? (
              <span className="muted" role="status">
                {t('skills.builtin_readonly', 'Built-in skill — read-only.')}
              </span>
            ) : (
              <>
                <button type="submit" className="primary" disabled={!dirty || !name.trim() || update.isPending}>
                  {t('common.save')}
                </button>
                {saved && <span className="muted" role="status">{saved}</span>}
                {update.isError && <span className="err">{(update.error as Error).message}</span>}
              </>
            )}
          </div>
        </div>
      </form>
      {bodyOpen && (
        <aside className="prompt-panel">
          <div className="prompt-head">
            <span className="tag">SKILL.md</span>
            <span className="mono muted prompt-path">{existing.relPath}</span>
            <span style={{ flex: 1 }} />
            {!isBuiltin && (
              <button
                className="icon-btn"
                type="button"
                onClick={() => { setBodyEditing((v) => !v); }}
                title={bodyEditing ? t('common.close', 'Close') : t('common.save', 'Edit')}
                aria-label="toggle edit"
              >
                {bodyEditing ? '👁' : '✎'}
              </button>
            )}
            <button
              className="icon-btn"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(body).catch(() => undefined);
              }}
              disabled={!body}
              title={t('prompt.copy', 'Copy')}
              aria-label={t('prompt.copy', 'Copy')}
            >
              <CopyIcon />
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={() => { setBodyOpen(false); }}
              title={t('common.close', 'Close')}
              aria-label={t('common.close', 'Close')}
            >×</button>
          </div>
          <div className="prompt-body">
            {bodyEditing && !isBuiltin ? (
              <textarea
                value={body}
                onChange={(e) => { setBody(e.target.value); }}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 0,
                  outline: 0,
                  resize: 'none',
                  padding: '0.75rem',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 12,
                  background: 'transparent',
                  color: 'inherit',
                }}
              />
            ) : (
              body ? (
                <pre className="prompt-md">{body}</pre>
              ) : (
                <div className="muted" style={{ padding: '0.75rem' }}>
                  {t('prompt.missing', 'No prompt file for this {{kind}} yet.', { kind: 'skill' })}
                </div>
              )
            )}
          </div>
        </aside>
      )}
      </div>
    </>
  );
}
