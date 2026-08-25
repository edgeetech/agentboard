import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { api } from '../api';
import { ProjectNotFound } from '../components/ProjectNotFound';
import { Board } from '../features/board/Board';
import { SetupWizard } from '../features/board/SetupWizard';

export function BoardPage() {
  const { projectCode } = useParams<{ projectCode: string }>();
  const upper = projectCode ? projectCode.toUpperCase() : null;
  const list = useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects });
  const active = useQuery({
    queryKey: ['active-project'],
    queryFn: api.activeProject,
    enabled: !upper,
  });

  if (list.isLoading || (!upper && active.isLoading)) {
    return <div className="center"><div className="spinner" /></div>;
  }

  const project = upper
    ? list.data?.projects.find((p: any) => p.code === upper) ?? null
    : active.data?.project;

  if (!project) {
    if (upper) return <ProjectNotFound code={upper} />;
    return <SetupWizard />;
  }
  // Key by code so React tears down Board's local state (e.g. open drawer,
  // selected task, filters) when the user switches projects.
  return <Board key={project.code} project={project} />;
}
