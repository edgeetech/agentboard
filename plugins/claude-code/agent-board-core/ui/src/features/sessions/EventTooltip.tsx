import { ReactNode } from 'react';
import { Tooltip } from '../../components/Tooltip';

/* Category → swatch colour (token) + inline SVG icon. Chunky 14px glyphs,
   monochrome, currentColor so they inherit the category hue. */
type Cat = 'file' | 'rule' | 'cwd' | 'error' | 'git' | 'env' | 'task'
         | 'plan' | 'skill' | 'subagent' | 'mcp' | 'decision' | 'worktree'
         | 'prompt' | 'role' | 'intent' | 'data' | 'hook' | 'session'
         | 'stop' | 'notify' | 'default';

function categoryOf(type: string): Cat {
  if (type.startsWith('file_'))      return 'file';
  if (type === 'rule' || type === 'rule_content') return 'rule';
  if (type === 'cwd')                return 'cwd';
  if (type === 'error_tool')         return 'error';
  if (type === 'git')                return 'git';
  if (type === 'env')                return 'env';
  if (type.startsWith('task'))       return 'task';
  if (type.startsWith('plan'))       return 'plan';
  if (type === 'skill')              return 'skill';
  if (type.startsWith('subagent'))   return 'subagent';
  if (type === 'mcp')                return 'mcp';
  if (type.startsWith('decision'))   return 'decision';
  if (type === 'worktree')           return 'worktree';
  if (type === 'user_prompt')        return 'prompt';
  if (type === 'role')               return 'role';
  if (type === 'intent')             return 'intent';
  if (type === 'data')               return 'data';
  if (type === 'hook_started' || type === 'hook_response') return 'hook';
  if (type === 'UserPromptSubmit' || type === 'PreToolUse' || type === 'PostToolUse'
      || type === 'PreCompact'      || type === 'Compact') return 'hook';
  if (type === 'SessionStart' || type === 'SessionEnd') return 'session';
  if (type === 'Stop' || type === 'SubagentStop') return 'stop';
  if (type === 'Notification')       return 'notify';
  return 'default';
}

const SVG = {
  base: 'fill-none stroke-current',
  p: (d: string) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.split('|').map((seg, i) => <path key={i} d={seg} />)}
    </svg>
  ),
};

const ICONS: Record<Cat, ReactNode> = {
  file:      SVG.p('M3 2.5h6l3 3V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V3a.5.5 0 0 1 .5-.5Z|M9 2.5v3h3'),
  rule:      SVG.p('M3 3h5v10H3z|M8 3h5v10H8z|M10.5 3v10'),
  cwd:       SVG.p('M2.5 4h11v8h-11z|M5 7l2 1-2 1|M8.5 9h3'),
  error:     SVG.p('M8 2l6 11H2L8 2z|M8 6.5v3|M8 11.5v.01'),
  git:       SVG.p('M5 2v12|M11 2v6a3 3 0 0 1-3 3H5|M5 3.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|M5 15.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|M11 3.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'),
  env:       SVG.p('M8.5 3.5l2 2-5.5 5.5-2.5.5.5-2.5z|M10 2l3 3-1.5 1.5-3-3z'),
  task:      SVG.p('M3 4h10M3 8h10M3 12h7|M13 11l1 1 2-2'),
  plan:      SVG.p('M2.5 3.5l4-1 3 1 4-1v10l-4 1-3-1-4 1z|M6.5 2.5v10|M9.5 3.5v10'),
  skill:     SVG.p('M8 2l1.4 3.4 3.6.4-2.7 2.4.8 3.6L8 10l-3.1 1.8.8-3.6L3 5.8l3.6-.4z'),
  subagent:  SVG.p('M4 6h8v7H4z|M5 9h.01M11 9h.01|M6.5 12h3|M8 3v3|M6 3h4'),
  mcp:       SVG.p('M5 3v4|M8 3v4|M11 3v4|M3.5 7h9v2c0 2-2 4-4.5 4S3.5 11 3.5 9z|M8 13v1.5'),
  decision:  SVG.p('M8 3v4|M5 7L8 4l3 3|M3 13h10'),
  worktree:  SVG.p('M4 3v10|M4 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z|M12 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z|M4 9c0 3 4 1.5 8 1.5'),
  prompt:    SVG.p('M3 3h10v7H8l-3 3v-3H3z'),
  role:      SVG.p('M8 4.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z|M3.5 13a4.5 4.5 0 0 1 9 0'),
  intent:    SVG.p('M8 2l5 5-5 5-5-5z|M8 5v4|M6 7h4'),
  data:      SVG.p('M3 4c0-1 2-2 5-2s5 1 5 2v8c0 1-2 2-5 2s-5-1-5-2z|M3 4c0 1 2 2 5 2s5-1 5-2|M3 8c0 1 2 2 5 2s5-1 5-2'),
  hook:      SVG.p('M4 2l2 5-2 1 6 6-2-5 2-1z'),
  session:   SVG.p('M5 3l7 5-7 5z'),
  stop:      SVG.p('M4 4h8v8H4z'),
  notify:    SVG.p('M8 2c-2.5 0-4 1.8-4 4 0 2.5-1 4-1 4h10s-1-1.5-1-4c0-2.2-1.5-4-4-4z|M6.5 12a1.5 1.5 0 1 0 3 0'),
  default:   SVG.p('M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z|M8 6v3|M8 11v.01'),
};

export function EventTooltip({
  type, description, children,
}: { type: string; description: string; children: ReactNode }) {
  const cat = categoryOf(type);
  const content = (
    <div className="event-tt">
      <div className={`event-tt-head cat-${cat}`}>
        <span className="event-tt-icon">{ICONS[cat]}</span>
        <span className="event-tt-type">{type}</span>
        <span className="event-tt-cat">{cat}</span>
      </div>
      {description && <div className="event-tt-body">{description}</div>}
    </div>
  );
  return <Tooltip content={content} maxWidth={360}>{children}</Tooltip>;
}
