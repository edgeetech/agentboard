import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SkillTreeBranchNode, SkillTreeNode } from './skillsTree';

interface LayoutNode {
  id: string;
  parentId: string | null;
  kind: 'branch' | 'leaf';
  label: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  skillCount?: number;
  emblem?: string;
  skillId?: string;
}

interface Layout {
  nodes: LayoutNode[];
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

const BRANCH_W = 140;
const BRANCH_H = 34;
const LEAF_W = 160;
const LEAF_H = 28;
const LEAF_GAP = 18;
const ROW_H = 90;
const PAD_X = 40;
const PAD_Y = 30;
const ROOT_GAP = 60;

function computeLayout(tree: SkillTreeBranchNode[]): Layout {
  const nodes: LayoutNode[] = [];
  const edges: { from: string; to: string }[] = [];

  const layoutRoot = (root: SkillTreeBranchNode, yOffset: number): number => {
    const rootNodes: LayoutNode[] = [];
    let leafCursor = 0;

    const walk = (node: SkillTreeNode, depth: number, parentId: string | null): LayoutNode => {
      const isBranch = node.kind === 'branch';
      const w = isBranch ? BRANCH_W : LEAF_W;
      const h = isBranch ? BRANCH_H : LEAF_H;
      const y = yOffset + depth * ROW_H;

      if (node.kind === 'leaf') {
        const x = PAD_X + leafCursor * (LEAF_W + LEAF_GAP);
        leafCursor += 1;
        const ln: LayoutNode = {
          id: node.id, parentId, kind: 'leaf', label: node.label, depth,
          x, y, width: w, height: h,
          emblem: node.skill.emblem, skillId: node.skill.id,
        };
        rootNodes.push(ln);
        return ln;
      }

      const childLayouts = node.children.map((child) => walk(child, depth + 1, node.id));
      let x: number;
      if (childLayouts.length === 0) {
        x = PAD_X + leafCursor * (LEAF_W + LEAF_GAP);
        leafCursor += 1;
      } else {
        const first = childLayouts[0];
        const last = childLayouts[childLayouts.length - 1];
        const firstCx = first.x + first.width / 2;
        const lastCx = last.x + last.width / 2;
        x = (firstCx + lastCx) / 2 - w / 2;
      }
      const ln: LayoutNode = {
        id: node.id, parentId, kind: 'branch', label: node.label, depth,
        x, y, width: w, height: h,
        skillCount: node.skillCount,
      };
      rootNodes.push(ln);
      for (const child of childLayouts) {
        edges.push({ from: node.id, to: child.id });
      }
      return ln;
    };

    walk(root, 0, null);
    nodes.push(...rootNodes);
    return rootNodes.reduce((m, n) => Math.max(m, n.y + n.height), yOffset);
  };

  let cursorY = PAD_Y;
  for (const root of tree) {
    const bottom = layoutRoot(root, cursorY);
    cursorY = bottom + ROOT_GAP;
  }

  const maxRight = nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const maxBottom = nodes.reduce((m, n) => Math.max(m, n.y + n.height), 0);
  return {
    nodes, edges,
    width: maxRight + PAD_X,
    height: maxBottom + PAD_Y,
  };
}

function edgePath(from: LayoutNode, to: LayoutNode): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function SkillsDiagram({ tree }: { tree: SkillTreeBranchNode[] }): JSX.Element {
  const navigate = useNavigate();
  const layout = useMemo(() => computeLayout(tree), [tree]);
  const nodeById = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    for (const n of layout.nodes) map.set(n.id, n);
    return map;
  }, [layout]);

  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const svgRef = useRef<SVGSVGElement | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest('.diagram-leaf')) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: view.x,
        origY: view.y,
      };
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    },
    [view.x, view.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const delta = -e.deltaY * 0.0015;
        const nextScale = Math.min(2.5, Math.max(0.4, v.scale * (1 + delta)));
        const ratio = nextScale / v.scale;
        return {
          scale: nextScale,
          x: cx - (cx - v.x) * ratio,
          y: cy - (cy - v.y) * ratio,
        };
      });
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, []);

  const handleLeafActivate = useCallback(
    (skillId: string) => {
      navigate(`/skills/${skillId}`);
    },
    [navigate],
  );

  const resetView = useCallback(() => setView({ x: 0, y: 0, scale: 1 }), []);
  const zoomBy = useCallback((factor: number) => {
    setView((v) => ({ ...v, scale: Math.min(2.5, Math.max(0.4, v.scale * factor)) }));
  }, []);

  if (tree.length === 0) {
    return (
      <div className="skills-diagram">
        <div className="empty-state">No skills to diagram</div>
      </div>
    );
  }

  return (
    <div className="skills-diagram">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="diagram-edges">
            {layout.edges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) return null;
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={edgePath(from, to)}
                  fill="none"
                  className="diagram-edge"
                />
              );
            })}
          </g>
          {layout.nodes.map((node) =>
            node.kind === 'branch' ? (
              <g key={node.id} className="diagram-branch" transform={`translate(${node.x} ${node.y})`}>
                <rect width={node.width} height={node.height} rx={8} ry={8} />
                <text x={12} y={node.height / 2 + 4} className="diagram-branch-label">
                  {node.label}
                </text>
                <g transform={`translate(${node.width - 30} ${node.height / 2 - 9})`}>
                  <rect width={24} height={18} rx={9} ry={9} className="diagram-branch-badge" />
                  <text x={12} y={13} textAnchor="middle" className="diagram-branch-count">
                    {node.skillCount ?? 0}
                  </text>
                </g>
              </g>
            ) : (
              <g
                key={node.id}
                className="diagram-leaf"
                transform={`translate(${node.x} ${node.y})`}
                tabIndex={0}
                role="link"
                onClick={() => node.skillId && handleLeafActivate(node.skillId)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && node.skillId) {
                    e.preventDefault();
                    handleLeafActivate(node.skillId);
                  }
                }}
              >
                <rect width={node.width} height={node.height} rx={6} ry={6} />
                <text x={10} y={node.height / 2 + 4} className="diagram-leaf-emblem">
                  {node.emblem ?? ''}
                </text>
                <text x={32} y={node.height / 2 + 4} className="diagram-leaf-label">
                  {node.label}
                </text>
              </g>
            ),
          )}
        </g>
      </svg>
      <div className="diagram-zoom-controls">
        <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={resetView} aria-label="Reset view">
          ⤾
        </button>
      </div>
    </div>
  );
}
