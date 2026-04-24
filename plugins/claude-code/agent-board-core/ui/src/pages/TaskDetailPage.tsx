import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { TaskDetailPanel } from '../features/board/TaskDetailPanel';
import { ProjectNotFound } from '../components/ProjectNotFound';
import { useDetailView } from '../hooks/useDetailView';

export function TaskDetailPage() {
  const { t } = useTranslation();
  const { projectCode = '', taskCode = '' } = useParams<{ projectCode: string; taskCode: string }>();
  const projUpper = projectCode.toUpperCase();
  const navigate = useNavigate();
  const [, setDetailView] = useDetailView();
  const list = useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects });

  if (list.isLoading) return <div className="center"><div className="spinner" /></div>;
  const project = list.data?.projects.find((p: any) => p.code === projUpper) || null;
  if (!project) return <ProjectNotFound code={projUpper} />;
  const boardPath = `/projects/${projUpper}`;

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('task.title', 'Task')}</h1>
          <span className="subtitle">
            <Link to={boardPath}>{t('nav.board', 'Board')}</Link> <span className="muted">/</span>{' '}
            <span className="mono">{taskCode}</span>
          </span>
        </div>
        <div className="actions">
          <Link to={boardPath}><button className="ghost" type="button">← {t('nav.board', 'Board')}</button></Link>
        </div>
      </div>

      <TaskDetailPanel
        taskCode={taskCode}
        workflow={project.workflow_type}
        variant="inline"
        onSwapVariant={() => {
          setDetailView('panel');
          navigate(`${boardPath}?open=${encodeURIComponent(taskCode)}`);
        }}
      />
    </>
  );
}
