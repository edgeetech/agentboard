import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Logo } from './Logo';
import { EdgeeTechLogo } from './EdgeeTechLogo';
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
        <NavLink to="/theme">
          <span className="icon" aria-hidden>◐</span> {t('nav.theme', 'Theme')}
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
        <span className="foot-left">
          <span className="dot" />
          {offline ? t('app.offline') : t('foot.connected', 'Connected')}
          <span className="foot-sep">·</span>
          <span className="mono">{project?.code ?? '—'}</span>
        </span>
        <span className="foot-center">
          <span className="foot-crafted-label">{t('foot.crafted', 'Crafted at')}</span>
          <a href="https://edgeetech.com" target="_blank" rel="noopener noreferrer" className="foot-brand" aria-label="EdgeeTech Limited">
            <EdgeeTechLogo size={22} />
            <span className="foot-brand-text">EdgeeTech Limited</span>
          </a>
        </span>
        <span className="foot-right">
          <a href="https://github.com/edgeetech/agentboard" target="_blank" rel="noopener noreferrer">
            GitHub ↗
          </a>
          <span className="foot-sep">·</span>
          <span>{t('foot.docs', 'Docs')}</span>
          <span className="foot-sep">·</span>
          <span>© {new Date().getFullYear()}</span>
        </span>
      </footer>
    </div>
  );
}

function ThemeToggle() {
  const { scheme, toggle } = useTheme();
  const isDark = scheme === 'dark';
  return (
    <button
      className={'theme-toggle' + (isDark ? ' is-dark' : ' is-light')}
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      <svg className="ic sun" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="ic moon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
      <span className="thumb" aria-hidden />
    </button>
  );
}
