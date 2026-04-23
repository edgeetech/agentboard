import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadSkills } from '../data/catalog';
import { SearchIcon } from '../components/SearchIcon';

export function SkillsPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const items = useMemo(loadSkills, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(x =>
      x.name.toLowerCase().includes(s) ||
      x.description.toLowerCase().includes(s) ||
      x.tags.some(tag => tag.includes(s))
    );
  }, [q, items]);

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
          <div className="action-group">
            <label className="search-bar">
              <SearchIcon />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={t('skills.search', 'Search skills…')}
                aria-label="Search skills"
              />
            </label>
            <button className="primary" disabled title={t('common.coming_soon', 'Coming soon')}>
              + {t('skills.new', 'New skill')}
            </button>
          </div>
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
            <Link key={skill.id} to={`/skills/${skill.id}`} className="entity-card">
              <div className="emblem">{skill.emblem}</div>
              <h3>{skill.name}</h3>
              <p>{skill.description}</p>
              <div className="tags">
                {skill.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
