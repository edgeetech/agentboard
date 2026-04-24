import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { api } from '../api';

/** Shown in the main area when the URL's projectCode doesn't exist.
 *  Gives the user a quick list to jump to a valid project or create a new one. */
export function ProjectNotFound({ code }: { code: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects });
  const projects: Array<{ code: string; name: string; workflow_type?: string }> = data?.projects || [];

  return (
    <div className="empty-state project-not-found">
      <h3>{t('project.not_found_title', 'Project not found')}</h3>
      <p>
        <Trans
          i18nKey="project.not_found_body"
          values={{ code }}
          components={{ c: <code /> }}
          defaults="The project <c>{{code}}</c> doesn't exist. Pick one below or create a new project."
        />
      </p>
      <div className="project-not-found-list">
        {projects.map(p => (
          <button
            key={p.code}
            type="button"
            className="project-not-found-item"
            onClick={() => nav(`/projects/${p.code}`)}
          >
            <span className="name">{p.name}</span>
            <span className="code">{p.code}{p.workflow_type ? ` · ${p.workflow_type}` : ''}</span>
          </button>
        ))}
        <button
          type="button"
          className="project-not-found-item project-not-found-new"
          onClick={() => nav('/projects/new')}
        >
          + {t('nav.new_project', 'New project…')}
        </button>
      </div>
    </div>
  );
}
