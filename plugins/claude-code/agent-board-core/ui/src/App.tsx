import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { BoardPage } from './pages/BoardPage';
import { SkillsPage } from './pages/SkillsPage';
import { SkillDetailPage } from './pages/SkillDetailPage';
import { RolesPage } from './pages/RolesPage';
import { RoleDetailPage } from './pages/RoleDetailPage';
import { ProjectPage } from './pages/ProjectPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<BoardPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="skills/:id" element={<SkillDetailPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="roles/:id" element={<RoleDetailPage />} />
        <Route path="project" element={<ProjectPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
