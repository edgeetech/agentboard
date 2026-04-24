import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Logo } from './Logo';
import { useTheme } from '../theme/ThemeProvider';
import { LanguageSelector } from '../features/board/LanguageSelector';
import { ProjectPicker } from './ProjectPicker';
import { useCurrentProject } from '../hooks/useCurrentProjectCode';

const SIDEBAR_KEY = 'agentboard.sidebar.collapsed';

function useSidebarCollapsed(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0'); } catch {}
  }, [v]);
  // Keyboard shortcut: `[` toggles (ignored while typing in inputs)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '[') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      if (el && el.isContentEditable) return;
      setV(prev => !prev);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [v, setV];
}

export function AppShell() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const alive = useQuery({ queryKey: ['alive'], queryFn: api.alive, refetchInterval: 5000 });
  // projects-list used inside useCurrentProject; warm its cache eagerly here.
  useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects, enabled: alive.isSuccess });
  const offline = alive.failureCount >= 3;
  // Effective "current project" — URL code > last-viewed localStorage > first listed.
  const { project } = useCurrentProject();
  const boardHref = project ? `/projects/${project.code}` : '/';
  const projectHref = project ? `/projects/${project.code}/project` : '/';

  return (
    <div className={'app-shell' + (collapsed ? ' side-collapsed' : '')}>
      <nav className="app-nav">
        <NavLink to={boardHref} className="brand" aria-label="AgentBoard">
          <Logo size={28} />
          <span>AgentBoard</span>
        </NavLink>
        <div className="spacer" />
        <NavLink to={boardHref} end className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          {t('nav.board', 'Board')}
        </NavLink>
        <NavLink to="/skills" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          {t('nav.skills', 'Skills')}
        </NavLink>
        <NavLink to="/roles" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          {t('nav.roles', 'Roles')}
        </NavLink>
        <NavLink to={projectHref} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          {t('nav.project', 'Project')}
        </NavLink>
        <ThemeToggle />
        <LanguageSelector />
      </nav>

      <aside className="app-side">
        <div className="section">{t('nav.workspace', 'Workspace')}</div>
        <NavLink to={boardHref} end title={t('nav.board', 'Board')}>
          <span className="icon" aria-hidden>▦</span>
          <span className="nav-label">{t('nav.board', 'Board')}</span>
        </NavLink>
        <NavLink to="/skills" title={t('nav.skills', 'Skills')}>
          <span className="icon" aria-hidden>✦</span>
          <span className="nav-label">{t('nav.skills', 'Skills')}</span>
        </NavLink>
        <NavLink to="/roles" title={t('nav.roles', 'Roles')}>
          <span className="icon" aria-hidden>◉</span>
          <span className="nav-label">{t('nav.roles', 'Roles')}</span>
        </NavLink>
        <NavLink to="/sessions" title={t('nav.sessions', 'Sessions')}>
          <span className="icon" aria-hidden>⟳</span>
          <span className="nav-label">{t('nav.sessions', 'Sessions')}</span>
        </NavLink>
        <div className="section">{t('nav.manage', 'Manage')}</div>
        <NavLink to={projectHref} title={t('nav.project', 'Project')}>
          <span className="icon" aria-hidden>⌘</span>
          <span className="nav-label">{t('nav.project', 'Project')}</span>
        </NavLink>
        <NavLink to="/theme" title={t('nav.theme', 'Theme')}>
          <span className="icon" aria-hidden>◐</span>
          <span className="nav-label">{t('nav.theme', 'Theme')}</span>
        </NavLink>
        <ProjectPicker />

        <button
          type="button"
          className="side-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? t('nav.expand', 'Expand sidebar ([)') : t('nav.collapse', 'Collapse sidebar ([)')}
          aria-label={collapsed ? t('nav.expand', 'Expand sidebar') : t('nav.collapse', 'Collapse sidebar')}
          aria-expanded={!collapsed}
        >
          <svg className="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points={collapsed ? '9 6 15 12 9 18' : '15 6 9 12 15 18'} />
          </svg>
          <span className="side-toggle-label">
            {collapsed ? t('nav.expand', 'Expand') : t('nav.collapse', 'Collapse')}
          </span>
        </button>
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
          {t('foot.crafted', 'Crafted at')}{' '}
          <a href="https://edgeetech.com" target="_blank" rel="noopener noreferrer" className="foot-brand">
            EdgeeTech Limited
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
