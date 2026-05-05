// LiquidJS prompt builder for role prompts.
// Ported from hatice src/prompt-builder.ts.

import { Liquid } from 'liquidjs';

const engine = new Liquid({ strictVariables: false, strictFilters: false });

export interface TaskRow {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  status: string;
  rework_count?: number | null;
  acceptance_criteria_json?: string | null;
  workspace_path?: string | null;
}

export interface ProjectRow {
  name: string;
  workflow_type: string;
  repo_path: string;
}

export interface CommentRow {
  author_role: string;
  body: string;
}

export interface SkillContext {
  name: string;
  description: string;
  emblem: string;
  relDir: string;
  relPath: string;
  tags: string[];
}

export interface PromptVariables {
  role: string;
  task: {
    id: string;
    code: string;
    title: string;
    description: string;
    status: string;
    rework_count: number;
    acceptance_criteria: string[];
    workspace_path: string | null;
  };
  project: {
    name: string;
    workflow_type: string;
    repo_path: string;
  };
  runId: string;
  runToken: string;
  rework_count: number;
  last_error: string | null;
  blockers: string[];
  acceptance_criteria: string[];
  comments: string[];
  skills: SkillContext[];
  skills_truncated: boolean;
}

/**
 * Render a LiquidJS prompt template.
 */
export async function renderPromptTemplate(
  template: string,
  variables: Record<string, unknown>,
): Promise<string> {
  return engine.parseAndRender(template, variables) as Promise<string>;
}

/**
 * Build a structured prompt for a given role using the agentboard data model.
 * Falls back to a plain prompt if template rendering fails.
 */
export async function buildRolePrompt(
  role: string,
  task: TaskRow,
  project: ProjectRow,
  runId: string,
  runToken: string,
  comments: CommentRow[] | null | undefined,
  templateOverride?: string,
  skills?: SkillContext[],
): Promise<string> {
  const ac = safeParseAc(task.acceptance_criteria_json);
  const acList = ac.map((a, i) => `${i + 1}. [${a.checked ? 'x' : ' '}] ${a.text}`);
  const recent = (comments ?? []).slice(-10).map((c) => `[${c.author_role}] ${c.body}`);

  const allSkills = (skills ?? []).slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const skillsTruncated = allSkills.length > 50;
  const skillList = skillsTruncated ? allSkills.slice(0, 50) : allSkills;

  const variables: PromptVariables = {
    role,
    task: {
      id: task.id,
      code: task.code,
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      rework_count: task.rework_count ?? 0,
      acceptance_criteria: acList,
      workspace_path: task.workspace_path ?? null,
    },
    project: {
      name: project.name,
      workflow_type: project.workflow_type,
      repo_path: project.repo_path,
    },
    runId,
    runToken,
    rework_count: task.rework_count ?? 0,
    last_error: null,
    blockers: [],
    acceptance_criteria: acList,
    comments: recent,
    skills: skillList,
    skills_truncated: skillsTruncated,
  };

  if (templateOverride) {
    try {
      return await renderPromptTemplate(
        templateOverride,
        variables as unknown as Record<string, unknown>,
      );
    } catch (e) {
      console.warn(
        '[prompt-builder] template render failed, using default:',
        e instanceof Error ? e.message : e,
      );
    }
  }

  // Default prompt (same as original executor renderPrompt)
  return `You are the ${role.toUpperCase()} agent. Follow your system prompt exactly.

run_id: ${runId}
run_token: ${runToken}
task_id: ${task.id}
task_code: ${task.code}
workflow_type: ${project.workflow_type}
repo_path: ${project.repo_path}

Title: ${task.title}

Description:
${task.description ?? '(empty — you are PM; enrich this)'}

Acceptance criteria (${ac.length}):
${acList.join('\n') || '(none yet)'}

Recent comments:
${recent.join('\n') || '(none)'}

Begin. Use mcp__abrun__* tools (list_queue, claim_run, get_task, update_task, add_comment, finish_run, add_heartbeat). Finish with finish_run.`;
}

/**
 * Render a role system prompt template (prompts/<role>.md content) through
 * Liquid using the same variable shape as buildRolePrompt. Falls back to
 * the raw template on render failure (preserves prior behavior).
 */
export async function renderSystemPrompt(
  template: string,
  task: TaskRow,
  project: ProjectRow,
  runId: string,
  runToken: string,
  comments: CommentRow[] | null | undefined,
  skills?: SkillContext[],
): Promise<string> {
  const ac = safeParseAc(task.acceptance_criteria_json);
  const acList = ac.map((a, i) => `${i + 1}. [${a.checked ? 'x' : ' '}] ${a.text}`);
  const recent = (comments ?? []).slice(-10).map((c) => `[${c.author_role}] ${c.body}`);
  const allSkills = (skills ?? []).slice().sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const skillsTruncated = allSkills.length > 50;
  const skillList = skillsTruncated ? allSkills.slice(0, 50) : allSkills;

  const variables: PromptVariables = {
    role: '',
    task: {
      id: task.id,
      code: task.code,
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      rework_count: task.rework_count ?? 0,
      acceptance_criteria: acList,
      workspace_path: task.workspace_path ?? null,
    },
    project: {
      name: project.name,
      workflow_type: project.workflow_type,
      repo_path: project.repo_path,
    },
    runId,
    runToken,
    rework_count: task.rework_count ?? 0,
    last_error: null,
    blockers: [],
    acceptance_criteria: acList,
    comments: recent,
    skills: skillList,
    skills_truncated: skillsTruncated,
  };

  try {
    return await renderPromptTemplate(template, variables as unknown as Record<string, unknown>);
  } catch (e) {
    console.warn(
      '[prompt-builder] system prompt render failed, using raw:',
      e instanceof Error ? e.message : e,
    );
    return template;
  }
}

interface AcItem {
  checked: boolean;
  text: string;
}

function safeParseAc(s: string | null | undefined): AcItem[] {
  try {
    return JSON.parse(s ?? '[]') as AcItem[];
  } catch {
    return [];
  }
}
