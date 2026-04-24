import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useCurrentProject } from '../hooks/useCurrentProjectCode';

type Project = { code: string; name: string; workflow_type?: string };

/**
 * Sidebar project switcher. Replaces the old static "Active project" card.
 * Trigger shows the same name/code/workflow info as the card; click to open
 * a popup menu that lists all projects in the same format.
 */
export function ProjectPicker() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({ queryKey: ['projects-list'], queryFn: api.listProjects });
  const projects: Project[] = data?.projects || [];
  // Selected project = URL code > localStorage last-viewed > first listed.
  // This keeps the picker in sync on non-project routes (Skills, Sessions…).
  const { project: selected } = useCurrentProject();
  const current = selected?.code || '';

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (projects.length === 0) {
    return (
      <div className="project-card project-picker-card">
        <div className="label">{t('nav.active', 'Active project')}</div>
        <button className="project-picker-empty" onClick={() => nav('/projects/new')}>
          + New project
        </button>
      </div>
    );
  }

  return (
    <div className="project-card project-picker-card" ref={rootRef}>
      <div className="label">{t('nav.active', 'Active project')}</div>
      <button
        type="button"
        className="project-picker-trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="project-picker-main">
          <div className="name">{selected?.name ?? t('nav.pick_project', 'Pick a project…')}</div>
          <div className="code">
            {selected ? `${selected.code}${selected.workflow_type ? ` · ${selected.workflow_type}` : ''}` : ''}
          </div>
        </div>
        <span className="project-picker-caret" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="project-picker-menu" role="listbox">
          {projects.map(p => (
            <button
              key={p.code}
              type="button"
              role="option"
              aria-selected={p.code === current}
              className={'project-picker-item' + (p.code === current ? ' is-active' : '')}
              onClick={() => { setOpen(false); nav(`/projects/${p.code}`); }}
            >
              <div className="name">{p.name}</div>
              <div className="code">{p.code}{p.workflow_type ? ` · ${p.workflow_type}` : ''}</div>
            </button>
          ))}
          <button
            type="button"
            className="project-picker-item project-picker-new"
            onClick={() => { setOpen(false); nav('/projects/new'); }}
          >
            + {t('nav.new_project', 'New project…')}
          </button>
        </div>
      )}
    </div>
  );
}
