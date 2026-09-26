import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';

import { api } from './api';
import { AppShell } from './components/AppShell';
import { Skeleton } from './components/Skeleton';
import { ToastHost } from './components/Toast';
import { SetupWizard } from './features/board/SetupWizard';
import { recallLastProject } from './hooks/useCurrentProjectCode';
import { useProjectCode } from './hooks/useProjectCode';
import { BoardPage } from './pages/BoardPage';

// The board is the landing page and ships in the main chunk; every other page
// is split into its own chunk and fetched on first navigation.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const PersonasPage = named(() => import('./pages/PersonasPage'), 'PersonasPage');
const ProjectPage = named(() => import('./pages/ProjectPage'), 'ProjectPage');
const RoleDetailPage = named(() => import('./pages/RoleDetailPage'), 'RoleDetailPage');
const SessionDetailPage = named(() => import('./pages/SessionDetailPage'), 'SessionDetailPage');
const SessionsPage = named(() => import('./pages/SessionsPage'), 'SessionsPage');
const SkillDetailPage = named(() => import('./pages/SkillDetailPage'), 'SkillDetailPage');
const SkillsPage = named(() => import('./pages/SkillsPage'), 'SkillsPage');
const TaskDetailPage = named(() => import('./pages/TaskDetailPage'), 'TaskDetailPage');
const ThemePage = named(() => import('./pages/ThemePage'), 'ThemePage');

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RedirectSkeleton />}>{children}</Suspense>;
}

/** Outlet wrapper that keeps the api module's per-tab projectCode in sync. */
function ProjectScoped() {
  useProjectCode();
  return <Outlet />;
}

function RedirectSkeleton() {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', maxWidth: 480 }}>
      <Skeleton width={160} height={20} />
      <Skeleton height={120} radius="var(--radius-lg)" />
    </div>
  );
}

/** Landing redirect. If there is a last-active project, go there; otherwise
 *  go to setup (BoardPage shows SetupWizard when no project selected). */
function RootRedirect() {
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject });
  const list = useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects });
  if (active.isLoading || list.isLoading) {
    return <RedirectSkeleton />;
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
    <>
      <ToastHost />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<RootRedirect />} />
          <Route path="sessions" element={<Page><SessionsPage /></Page>} />
          <Route path="sessions/:hash/:sessionId" element={<Page><SessionDetailPage /></Page>} />
          <Route path="skills" element={<Page><SkillsPage /></Page>} />
          <Route path="skills/:id" element={<Page><SkillDetailPage /></Page>} />
          <Route path="personas" element={<Page><PersonasPage /></Page>} />
          <Route path="personas/:id" element={<Page><RoleDetailPage /></Page>} />
          <Route path="theme" element={<Page><ThemePage /></Page>} />
          <Route path="projects" element={<ProjectScoped />}>
            <Route path="new" element={<SetupWizard />} />
            <Route path=":projectCode" element={<BoardPage />} />
            <Route path=":projectCode/tasks/:taskCode" element={<Page><TaskDetailPage /></Page>} />
            <Route path=":projectCode/project" element={<Page><ProjectPage /></Page>} />
          </Route>
          {/* Legacy redirects — old deep links keep working. */}
          <Route path="tasks/:taskCode" element={<LegacyTaskRedirect />} />
          <Route path="project" element={<LegacyProjectRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

function LegacyTaskRedirect() {
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject });
  if (active.isLoading) return <RedirectSkeleton />;
  const projCode = active.data?.project?.code;
  if (!projCode) return <Navigate to="/" replace />;
  const taskCode = window.location.pathname.split('/').pop() || '';
  return <Navigate to={`/projects/${projCode}/tasks/${taskCode}`} replace />;
}

function LegacyProjectRedirect() {
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject });
  if (active.isLoading) return <RedirectSkeleton />;
  const projCode = active.data?.project?.code;
  if (!projCode) return <Navigate to="/" replace />;
  return <Navigate to={`/projects/${projCode}/project`} replace />;
}
