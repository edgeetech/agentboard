import { useQuery } from '@tanstack/react-query';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';

import { api } from './api';
import { AppShell } from './components/AppShell';
import { SetupWizard } from './features/board/SetupWizard';
import { recallLastProject } from './hooks/useCurrentProjectCode';
import { useProjectCode } from './hooks/useProjectCode';
import { BoardPage } from './pages/BoardPage';
import { PersonasPage } from './pages/PersonasPage';
import { ProjectPage } from './pages/ProjectPage';
import { RoleDetailPage } from './pages/RoleDetailPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { SessionsPage } from './pages/SessionsPage';
import { SkillDetailPage } from './pages/SkillDetailPage';
import { SkillsPage } from './pages/SkillsPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { ThemePage } from './pages/ThemePage';

/** Outlet wrapper that keeps the api module's per-tab projectCode in sync. */
function ProjectScoped() {
  useProjectCode();
  return <Outlet />;
}

/** Landing redirect. If there is a last-active project, go there; otherwise
 *  go to setup (BoardPage shows SetupWizard when no project selected). */
function RootRedirect() {
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject });
  const list = useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects });
  if (active.isLoading || list.isLoading) {
    return <div className="center"><div className="spinner" /></div>;
  }
  const lastCode = recallLastProject();
  const hasLast = lastCode && list.data?.projects?.some((p: any) => p.code === lastCode.toUpperCase());
  const code = (hasLast ? lastCode.toUpperCase() : null)
    || active.data?.project?.code
    || list.data?.projects?.[0]?.code;
  if (code) return <Navigate to={`/projects/${code}`} replace />;
  return <BoardPage />;
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<RootRedirect />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:hash/:sessionId" element={<SessionDetailPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="skills/:id" element={<SkillDetailPage />} />
        <Route path="personas" element={<PersonasPage />} />
        <Route path="personas/:id" element={<RoleDetailPage />} />
        <Route path="theme" element={<ThemePage />} />
        <Route path="projects" element={<ProjectScoped />}>
          <Route path="new" element={<SetupWizard />} />
          <Route path=":projectCode" element={<BoardPage />} />
          <Route path=":projectCode/tasks/:taskCode" element={<TaskDetailPage />} />
          <Route path=":projectCode/project" element={<ProjectPage />} />
        </Route>
        {/* Legacy redirects — old deep links keep working. */}
        <Route path="tasks/:taskCode" element={<LegacyTaskRedirect />} />
        <Route path="project" element={<LegacyProjectRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function LegacyTaskRedirect() {
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject });
  if (active.isLoading) return <div className="center"><div className="spinner" /></div>;
  const projCode = active.data?.project?.code;
  if (!projCode) return <Navigate to="/" replace />;
  const taskCode = window.location.pathname.split('/').pop() || '';
  return <Navigate to={`/projects/${projCode}/tasks/${taskCode}`} replace />;
}

function LegacyProjectRedirect() {
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject });
  if (active.isLoading) return <div className="center"><div className="spinner" /></div>;
  const projCode = active.data?.project?.code;
  if (!projCode) return <Navigate to="/" replace />;
  return <Navigate to={`/projects/${projCode}/project`} replace />;
}
