import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadRoles } from '../data/catalog';
import { SearchIcon } from '../components/SearchIcon';

export function PersonasPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const items = useMemo(loadRoles, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.description.toLowerCase().includes(s) ||
      r.skills.some(x => x.includes(s))
    );
  }, [q, items]);

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('personas.title', 'Personas')}</h1>
          <span className="subtitle">
            {t('personas.subtitle', 'Agent personas that act on your tasks.')}
          </span>
        </div>
        <div className="actions">
          <div className="action-group">
            <label className="search-bar">
              <SearchIcon />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={t('personas.search', 'Search personas…')}
                aria-label="Search personas"
              />
            </label>
            <button className="primary" disabled title={t('common.coming_soon', 'Coming soon')}>
              + {t('personas.new', 'New persona')}
            </button>
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <h3>{t('personas.empty_title', 'No matches')}</h3>
          <p>{t('personas.empty_body', 'Try a different search term.')}</p>
        </div>
      ) : (
        <div className="entity-grid">
          {list.map(role => (
            <Link key={role.id} to={`/personas/${role.id}`} className="entity-card">
              <div className="emblem">{role.emblem}</div>
              <h3>{role.name}</h3>
              <p>{role.description}</p>
              <div className="tags">
                {role.skills.map(s => <span key={s} className="tag">{s}</span>)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
