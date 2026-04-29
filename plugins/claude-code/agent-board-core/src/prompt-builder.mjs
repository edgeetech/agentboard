// LiquidJS prompt builder for role prompts.
// Ported from hatice src/prompt-builder.ts.

import { Liquid } from 'liquidjs';

const engine = new Liquid({ strictVariables: false, strictFilters: false });

/**
 * @typedef {Object} PromptVariables
 * @property {object} task           - agentboard task row
 * @property {string} task.code
 * @property {string} task.title
 * @property {string} [task.description]
 * @property {string} task.status
 * @property {number} task.rework_count
 * @property {object} project        - agentboard project row
 * @property {string} project.name
 * @property {string} project.workflow_type
 * @property {string} project.repo_path
 * @property {string} runId
 * @property {string} runToken
 * @property {number} [rework_count]
 * @property {string} [last_error]
 * @property {string[]} [blockers]
 * @property {string[]} [acceptance_criteria]
 * @property {string} [role]
 * @property {Array<{author_role:string,body:string}>} [comments]
 */

/**
 * Render a LiquidJS prompt template.
 * @param {string} template - LiquidJS template string
 * @param {PromptVariables} variables
 * @returns {Promise<string>}
 */
export async function renderPromptTemplate(template, variables) {
  return engine.parseAndRender(template, variables);
}

/**
 * Build a structured prompt for a given role using the agentboard data model.
 * Falls back to a plain prompt if template rendering fails.
 *
 * @param {string} role          - 'pm'|'worker'|'reviewer'
 * @param {object} task          - task row from DB
 * @param {object} project       - project row from DB
 * @param {string} runId
 * @param {string} runToken
 * @param {Array<{author_role:string,body:string}>} comments
 * @param {string} [templateOverride]  - LiquidJS template string to use instead of default
 * @returns {Promise<string>}
 */
export async function buildRolePrompt(role, task, project, runId, runToken, comments, templateOverride) {
  const ac = safeParseAc(task.acceptance_criteria_json);
  const acList = ac.map((a, i) => `${i + 1}. [${a.checked ? 'x' : ' '}] ${a.text}`);
  const recent = (comments ?? []).slice(-10).map(c => `[${c.author_role}] ${c.body}`);

  const variables = {
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
  };

  if (templateOverride) {
    try {
      return await renderPromptTemplate(templateOverride, variables);
    } catch (e) {
      console.warn('[prompt-builder] template render failed, using default:', e?.message);
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
${task.description || '(empty — you are PM; enrich this)'}

Acceptance criteria (${ac.length}):
${acList.join('\n') || '(none yet)'}

Recent comments:
${recent.join('\n') || '(none)'}

Begin. Use mcp__abrun__* tools (list_queue, claim_run, get_task, update_task, add_comment, finish_run, add_heartbeat). Finish with finish_run.`;
}

/** @param {string} s @returns {Array<{checked:boolean,text:string}>} */
function safeParseAc(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}
