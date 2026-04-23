import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Skill = {
  id: string;
  name: string;
  emblem: string;
  description: string;
  tags: string[];
};

const CATALOG: Skill[] = [
  { id: 'code-review', name: 'Code Review', emblem: 'CR',
    description: 'Inspect a diff against coding standards, flag bugs, suggest fixes inline.',
    tags: ['reviewer', 'default'] },
  { id: 'unit-tests', name: 'Unit Tests', emblem: 'UT',
    description: 'Generate / update unit tests so new behaviour is covered and regressions guarded.',
    tags: ['worker', 'jest', 'pytest'] },
  { id: 'tech-spec', name: 'Tech Spec Drafting', emblem: 'TS',
    description: 'Turn a loose description into acceptance criteria, risks, and a work breakdown.',
    tags: ['pm', 'default'] },
  { id: 'refactor', name: 'Refactor', emblem: 'RF',
    description: 'Rework an existing module for clarity, reuse, or performance without changing behaviour.',
    tags: ['worker'] },
  { id: 'api-client', name: 'API Client', emblem: 'AC',
    description: 'Wire a typed API client to a remote service, including retry and error handling.',
    tags: ['worker', 'typescript'] },
  { id: 'release-notes', name: 'Release Notes', emblem: 'RN',
    description: 'Summarise merged PRs into concise release notes grouped by scope and impact.',
    tags: ['reviewer'] },
];

export function SkillsPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return CATALOG;
    return CATALOG.filter(x =>
      x.name.toLowerCase().includes(s) ||
      x.description.toLowerCase().includes(s) ||
      x.tags.some(tag => tag.includes(s))
    );
  }, [q]);

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('skills.title', 'Skills')}</h1>
          <span className="subtitle">
            {t('skills.subtitle', 'Reusable abilities you can attach to a role or run.')}
          </span>
        </div>
        <div className="actions">
          <label className="search-bar">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('skills.search', 'Search skills…')}
              aria-label="Search skills"
            />
            <span className="kbd">/</span>
          </label>
          <button className="primary" disabled title={t('common.coming_soon', 'Coming soon')}>
            + {t('skills.new', 'New skill')}
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <h3>{t('skills.empty_title', 'No matches')}</h3>
          <p>{t('skills.empty_body', 'Try a different search term.')}</p>
        </div>
      ) : (
        <div className="entity-grid">
          {list.map(skill => (
            <article key={skill.id} className="entity-card">
              <div className="emblem">{skill.emblem}</div>
              <h3>{skill.name}</h3>
              <p>{skill.description}</p>
              <div className="tags">
                {skill.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
