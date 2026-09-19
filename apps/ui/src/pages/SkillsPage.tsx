import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { SkillScanEvent } from '../api';
import type { SkillTreeBranchNode, SkillTreeNode } from './skillsTree';
import { api, getProjectCode, type ApiSkill } from '../api';
import { SearchIcon } from '../components/SearchIcon';
import { useCurrentProject } from '../hooks/useCurrentProjectCode';
import { useSkillScanEvents } from '../hooks/useSkillScanEvents';
import { buildSkillsTree, collectExpandedBranchIds } from './skillsTree';
import { SkillsDiagram } from './SkillsDiagram';

type SkillsViewMode = 'flat' | 'tree' | 'diagram';

const VIEW_STORAGE_KEY = 'agentboard.skills.view';

function expandedStorageKey(projectCode: string | null): string {
  return `agentboard.skills.tree.expanded:${projectCode ?? 'global'}`;
}

function loadViewMode(): SkillsViewMode {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === 'tree' || v === 'diagram' || v === 'flat') return v;
    return 'flat';
  } catch {
    return 'flat';
  }
}

function loadExpandedBranches(projectCode: string | null): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(expandedStorageKey(projectCode));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
    );
  } catch {
    return {};
  }
}

function saveExpandedBranches(projectCode: string | null, expanded: Record<string, boolean>): void {
  try {
    localStorage.setItem(expandedStorageKey(projectCode), JSON.stringify(expanded));
  } catch {}
}

function countVisibleTags(tags: string[]): string[] {
  return tags.slice(0, 3);
}

function TreeBranch(props: {
  branch: SkillTreeBranchNode;
  depth: number;
  isExpanded: (id: string, depth: number) => boolean;
  onToggle: (id: string, currentOpen: boolean) => void;
}) {
  const { branch, depth, isExpanded, onToggle } = props;
  const open = isExpanded(branch.id, depth);
  return (
    <li className="skills-tree-item">
      <button
        type="button"
        className="skills-tree-row skills-tree-branch"
        aria-expanded={open}
        onClick={() => { onToggle(branch.id, open); }}
        style={{ paddingLeft: `${0.55 + depth * 0.85}rem` }}
      >
        <span className={'skills-tree-caret' + (open ? ' open' : '')} aria-hidden>›</span>
        <span className="skills-tree-copy">
          <span className="skills-tree-name">{branch.label}</span>
          <span className="skills-tree-meta">
            <span className="skills-tree-path">{branch.path}</span>
          </span>
        </span>
        <span className="skills-tree-badge" aria-label={`${branch.skillCount} skills`}>
          {branch.skillCount}
        </span>
      </button>
      {open && (
        <ul className="skills-tree-children">
          {branch.children.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={depth + 1}
              isExpanded={isExpanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TreeLeaf(props: { skill: ApiSkill; path: string; depth: number }) {
  const { skill, path, depth } = props;
  return (
    <li className="skills-tree-item">
      <Link
        to={`/skills/${skill.id}`}
        className="skills-tree-row skills-tree-leaf"
        style={{ paddingLeft: `${0.55 + depth * 0.85}rem` }}
      >
        <span className="skills-tree-emblem">{skill.emblem || '··'}</span>
        <span className="skills-tree-copy">
          <span className="skills-tree-name">{skill.name}</span>
          <span className="skills-tree-meta">
            <span className="skills-tree-path">{path}</span>
            {skill.id.startsWith('builtin:') && <span className="tag">Built-in</span>}
          </span>
        </span>
        {skill.tags.length > 0 && (
          <span className="skills-tree-tags" aria-hidden>
            {countVisibleTags(skill.tags).map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </span>
        )}
      </Link>
    </li>
  );
}

function TreeNode(props: {
  node: SkillTreeNode;
  depth: number;
  isExpanded: (id: string, depth: number) => boolean;
  onToggle: (id: string, currentOpen: boolean) => void;
}) {
  const { node, depth, isExpanded, onToggle } = props;
  return node.kind === 'branch'
    ? (
        <TreeBranch
          branch={node}
          depth={depth}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      )
    : <TreeLeaf skill={node.skill} path={node.path} depth={depth} />;
}

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
  const deferredSearch = useDeferredValue(search.trim());
  const [view, setView] = useState<SkillsViewMode>(loadViewMode);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => loadExpandedBranches(projectCode));

  useEffect(() => {
    setExpanded(loadExpandedBranches(projectCode));
  }, [projectCode]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {}
  }, [view]);

  useEffect(() => {
    saveExpandedBranches(projectCode, expanded);
  }, [expanded, projectCode]);

  const skillsQ = useQuery({
    queryKey: ['skills', projectCode, deferredSearch],
    queryFn: () => api.listSkills({ search: deferredSearch || undefined }),
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
  const tree = useMemo(() => buildSkillsTree(skills), [skills]);
  const forcedExpanded = useMemo(
    () => (deferredSearch ? collectExpandedBranchIds(tree) : new Set<string>()),
    [deferredSearch, tree],
  );

  function toggleBranch(id: string, currentOpen: boolean) {
    setExpanded((current) => ({ ...current, [id]: !currentOpen }));
  }

  function expandAll() {
    setExpanded(Object.fromEntries([...collectExpandedBranchIds(tree)].map((id) => [id, true])));
  }
  function collapseAll() {
    setExpanded(Object.fromEntries([...collectExpandedBranchIds(tree)].map((id) => [id, false])));
  }

  function isExpanded(id: string, depth: number): boolean {
    if (deferredSearch) return forcedExpanded.has(id);
    return expanded[id] ?? depth === 0;
  }

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
                className={'ghost' + (view === 'tree' ? ' active' : '')}
                onClick={() => { setView('tree'); }}
              >
                {t('skills.view_tree', 'Tree')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'diagram'}
                className={'ghost' + (view === 'diagram' ? ' active' : '')}
                onClick={() => { setView('diagram'); }}
              >
                {t('skills.view_diagram', 'Diagram')}
              </button>
            </div>
            {view === 'tree' && (
              <div className="tree-bulk-actions">
                <button type="button" className="ghost small" onClick={expandAll}>
                  {t('skills.expand_all', 'Expand all')}
                </button>
                <button type="button" className="ghost small" onClick={collapseAll}>
                  {t('skills.collapse_all', 'Collapse all')}
                </button>
              </div>
            )}
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
        view === 'diagram' ? (
          <SkillsDiagram tree={tree} />
        ) : view === 'tree' ? (
          <div className="skills-tree" role="tree" aria-label={t('skills.title', 'Skills')}>
            <ul className="skills-tree-list">
              {tree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  isExpanded={isExpanded}
                  onToggle={toggleBranch}
                />
              ))}
            </ul>
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
        )
      )}
    </>
  );
}
