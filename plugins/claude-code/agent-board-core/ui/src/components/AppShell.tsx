import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Logo } from './Logo';
import { useTheme } from '../theme/ThemeProvider';
import { LanguageSelector } from '../features/board/LanguageSelector';

export function AppShell() {
  const { t } = useTranslation();
  const alive = useQuery({ queryKey: ['alive'], queryFn: api.alive, refetchInterval: 5000 });
  const active = useQuery({ queryKey: ['active-project'], queryFn: api.activeProject, enabled: alive.isSuccess });
  const offline = alive.failureCount >= 3;
  const project = active.data?.project;

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <NavLink to="/" className="brand" aria-label="AgentBoard">
          <Logo size={28} />
          <span>AgentBoard</span>
        </NavLink>
        <div className="spacer" />
        <NavLink to="/" end className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          {t('nav.board', 'Board')}
        </NavLink>
        <NavLink to="/skills" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          {t('nav.skills', 'Skills')}
        </NavLink>
        <NavLink to="/roles" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          {t('nav.roles', 'Roles')}
        </NavLink>
        <NavLink to="/project" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          {t('nav.project', 'Project')}
        </NavLink>
        <ThemeToggle />
        <LanguageSelector />
      </nav>

      <aside className="app-side">
        <div className="section">{t('nav.workspace', 'Workspace')}</div>
        <NavLink to="/" end>
          <span className="icon" aria-hidden>▦</span> {t('nav.board', 'Board')}
        </NavLink>
        <NavLink to="/skills">
          <span className="icon" aria-hidden>✦</span> {t('nav.skills', 'Skills')}
        </NavLink>
        <NavLink to="/roles">
          <span className="icon" aria-hidden>◉</span> {t('nav.roles', 'Roles')}
        </NavLink>
        <div className="section">{t('nav.manage', 'Manage')}</div>
        <NavLink to="/project">
          <span className="icon" aria-hidden>⌘</span> {t('nav.project', 'Project')}
        </NavLink>
        {project && (
          <div className="project-card">
            <div className="label">{t('nav.active', 'Active project')}</div>
            <div className="name">{project.name}</div>
            <div className="code">{project.code} · {project.workflow_type}</div>
          </div>
        )}
      </aside>

      <main className="app-main">
        {offline && <div className="offline-banner">{t('app.offline')}</div>}
        <Outlet />
      </main>

      <footer className={'app-foot' + (offline ? ' offline' : '')}>
        <span>
          <span className="dot" />
          {offline ? t('app.offline') : t('foot.connected', 'Connected')}
        </span>
        <span>
          AgentBoard · <span className="mono">{project?.code ?? '—'}</span>
        </span>
      </footer>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light' : 'Dark'}
    />
  );
}
