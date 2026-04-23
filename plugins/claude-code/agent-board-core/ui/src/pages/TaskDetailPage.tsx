import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { TaskDetailPanel } from '../features/board/TaskDetailPanel';
import { useDetailView } from '../hooks/useDetailView';

export function TaskDetailPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [, setDetailView] = useDetailView();
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject });

  if (active.isLoading) return <div className="center"><div className="spinner" /></div>;
  const project = active.data?.project;
  if (!project) {
    return (
      <div className="empty-state">
        <h3>{t('project.none_title', 'No active project')}</h3>
        <p>{t('project.none_body', 'Create a project from the Board page first.')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('task.title', 'Task')}</h1>
          <span className="subtitle">
            <Link to="/">{t('nav.board', 'Board')}</Link> <span className="muted">/</span>{' '}
            <span className="mono">{code}</span>
          </span>
        </div>
        <div className="actions">
          <Link to="/"><button className="ghost" type="button">← {t('nav.board', 'Board')}</button></Link>
        </div>
      </div>

      <TaskDetailPanel
        taskCode={code}
        workflow={project.workflow_type}
        variant="inline"
        onSwapVariant={() => {
          setDetailView('panel');
          navigate(`/?open=${encodeURIComponent(code)}`);
        }}
      />
    </>
  );
}
