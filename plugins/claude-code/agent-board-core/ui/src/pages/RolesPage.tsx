import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Role = {
  id: string;
  name: string;
  emblem: string;
  description: string;
  skills: string[];
};

const CATALOG: Role[] = [
  { id: 'pm', name: 'PM', emblem: 'PM',
    description: 'Enriches the task: writes description, acceptance criteria, breaks scope.',
    skills: ['tech-spec', 'triage'] },
  { id: 'worker', name: 'Worker', emblem: 'WK',
    description: 'Implements the change end-to-end: edits code, runs tests, commits.',
    skills: ['unit-tests', 'refactor', 'api-client'] },
  { id: 'reviewer', name: 'Reviewer', emblem: 'RV',
    description: 'Reviews the diff, raises issues, asks for rework or hands back for human approval.',
    skills: ['code-review', 'release-notes'] },
  { id: 'human', name: 'Human', emblem: 'HU',
    description: 'You. Approves done work or rejects back to the worker with a comment.',
    skills: ['approve', 'reject'] },
];

export function RolesPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return CATALOG;
    return CATALOG.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.description.toLowerCase().includes(s) ||
      r.skills.some(x => x.includes(s))
    );
  }, [q]);

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('roles.title', 'Roles')}</h1>
          <span className="subtitle">
            {t('roles.subtitle', 'Agent personas that act on your tasks.')}
          </span>
        </div>
        <div className="actions">
          <label className="search-bar">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('roles.search', 'Search roles…')}
              aria-label="Search roles"
            />
            <span className="kbd">/</span>
          </label>
          <button className="primary" disabled title={t('common.coming_soon', 'Coming soon')}>
            + {t('roles.new', 'New role')}
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <h3>{t('roles.empty_title', 'No matches')}</h3>
          <p>{t('roles.empty_body', 'Try a different search term.')}</p>
        </div>
      ) : (
        <div className="entity-grid">
          {list.map(role => (
            <article key={role.id} className="entity-card">
              <div className="emblem">{role.emblem}</div>
              <h3>{role.name}</h3>
              <p>{role.description}</p>
              <div className="tags">
                {role.skills.map(s => <span key={s} className="tag">{s}</span>)}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
