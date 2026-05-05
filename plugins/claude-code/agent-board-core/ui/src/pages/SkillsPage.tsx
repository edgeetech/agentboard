import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { SkillScanEvent } from '../api';
import { api, getProjectCode } from '../api';
import { SearchIcon } from '../components/SearchIcon';
import { useCurrentProject } from '../hooks/useCurrentProjectCode';
import { useSkillScanEvents } from '../hooks/useSkillScanEvents';

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function SkillsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { project } = useCurrentProject();
  const projectCode = getProjectCode() ?? project?.code ?? null;
  const repoPath: string = project?.repo_path ?? '';

  const [search, setSearch] = useState('');
  const [view, setView] = useState<'flat' | 'tree'>('flat');

  const skillsQ = useQuery({
    queryKey: ['skills', projectCode, search],
    queryFn: () => api.listSkills({ search: search || undefined }),
  });
  const scanQ = useQuery({
    queryKey: ['skills-scan-latest', projectCode],
    queryFn: () => api.latestSkillScan(),
    refetchInterval: 2000,
  });
  const rescan = useMutation({
    mutationFn: () => api.scanSkills('manual'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills-scan-latest', projectCode] });
    },
  });

  const onSseEvent = useCallback(
    (e: SkillScanEvent) => {
      if (e.type === 'skill-scan:finished') {
        qc.invalidateQueries({ queryKey: ['skills', projectCode] });
        qc.invalidateQueries({ queryKey: ['skills-scan-latest', projectCode] });
      } else if (e.type === 'skill-scan:started' || e.type === 'skill-scan:latest') {
        qc.invalidateQueries({ queryKey: ['skills-scan-latest', projectCode] });
      }
    },
    [qc, projectCode],
  );
  useSkillScanEvents(projectCode, onSseEvent);

  const isScanning = scanQ.data?.status === 'running' || scanQ.data?.status === 'queued';
  const skills = skillsQ.data?.skills ?? [];

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('skills.title', 'Skills')}</h1>
          <span className="subtitle">
            {t('skills.subtitle', 'Reusable abilities you can attach to a role or run.')}
          </span>
        </div>
        <div className="actions">
          <div className="action-group">
            <label className="search-bar">
              <SearchIcon />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); }}
                placeholder={t('skills.search', 'Search skills…')}
                aria-label="Search skills"
              />
            </label>
            <button
              className="primary"
              type="button"
              disabled={isScanning || rescan.isPending}
              onClick={() => { rescan.mutate(); }}
            >
              {isScanning
                ? t('skills.scanning', 'Scanning… {{count}} found', { count: scanQ.data?.foundCount ?? 0 })
                : t('skills.scan_btn', 'Rescan')}
            </button>
            {/* TODO: implement tree view rendering — toggle stub only */}
            <div className="view-toggle" role="tablist" aria-label="View mode">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'flat'}
                className={'ghost' + (view === 'flat' ? ' active' : '')}
                onClick={() => { setView('flat'); }}
              >
                {t('skills.view_flat', 'Flat')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'tree'}
                className="ghost"
                disabled
                title={t('skills.view_tree_coming', 'Tree view — coming soon')}
              >
                {t('skills.view_tree', 'Tree')}
              </button>
            </div>
            {scanQ.data?.endedAt && (
              <span className="muted">
                {t('skills.last_scan', 'Last scan: {{when}}', { when: relativeTime(scanQ.data.endedAt) })}
              </span>
            )}
            {scanQ.data?.status === 'failed' && scanQ.data.error && (
              <span className="err">
                {t('skills.scan_failed', 'Scan failed: {{error}}', { error: scanQ.data.error })}
              </span>
            )}
          </div>
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="empty-state">
          <h3>{t('skills.empty_title', 'No matches')}</h3>
          <p>
            {t('skills.empty_with_path', 'No skills found in `{{path}}`. Make sure your project has `.claude/skills/<name>/SKILL.md` files.', {
              path: repoPath || '(no repo path)',
            })}
          </p>
        </div>
      ) : (
        <div className="entity-grid">
          {skills.map(s => (
            <Link key={s.id} to={`/skills/${s.id}`} className="entity-card">
              <div className="emblem">{s.emblem}</div>
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <div className="tags">
                <span className="tag" title={t('skills.dir_chip_label', 'Location')}>{s.relDir}</span>
                {s.id.startsWith('builtin:') && (
                  <span className="tag">{t('skills.builtin', 'Built-in')}</span>
                )}
                {s.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
