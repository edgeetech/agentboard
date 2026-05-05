import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';


import { buildRolePrompt, renderPromptTemplate, renderSystemPrompt } from '../src/prompt-builder.ts';

const baseTask = {
  id: 'task-1',
  code: 'T-001',
  title: 'Fix the bug',
  description: 'There is a bug',
  status: 'agent_working',
  rework_count: 0,
  acceptance_criteria_json: JSON.stringify([{ checked: false, text: 'Bug is fixed' }]),
  workspace_path: null,
};

const baseProject = {
  name: 'MyProject',
  workflow_type: 'WF1',
  repo_path: '/repo',
};

describe('PromptBuilder', () => {
  it('buildRolePrompt with no templateOverride returns fallback string', async () => {
    const result = await buildRolePrompt('worker', baseTask, baseProject, 'run-1', 'tok-abc', []);
    expect(result).toContain('WORKER');
    expect(result).toContain('run-1');
    expect(result).toContain('T-001');
  });

  it('buildRolePrompt injects acceptance criteria', async () => {
    const result = await buildRolePrompt('reviewer', baseTask, baseProject, 'run-2', 'tok-xyz', []);
    expect(result).toContain('Bug is fixed');
  });

  it('buildRolePrompt includes recent comments', async () => {
    const comments = [{ author_role: 'pm', body: 'Please fix fast' }];
    const result = await buildRolePrompt(
      'worker',
      baseTask,
      baseProject,
      'run-3',
      'tok-1',
      comments,
    );
    expect(result).toContain('Please fix fast');
  });

  it('renderSystemPrompt renders the worker prompt with skills block', async () => {
    const url = new URL('../prompts/worker.md', import.meta.url);
    const tpl = readFileSync(url, 'utf8');
    const skills = [
      {
        name: 'ui-quality-check',
        description: 'UI checks',
        emblem: 'UI',
        relDir: 'Tax/ui/.claude/skills',
        relPath: 'Tax/ui/.claude/skills/ui-quality-check/SKILL.md',
        tags: [],
      },
    ];
    const out = await renderSystemPrompt(tpl, baseTask, baseProject, 'run-x', 'tok-x', [], skills);
    expect(out).toContain('## Available skills');
    expect(out).toContain('**ui-quality-check**');
    expect(out).toContain('Tax/ui/.claude/skills');
    expect(out).not.toContain('No skills are registered');
  });

  it('renderSystemPrompt renders empty-skills branch when none', async () => {
    const url = new URL('../prompts/pm.md', import.meta.url);
    const tpl = readFileSync(url, 'utf8');
    const out = await renderSystemPrompt(tpl, baseTask, baseProject, 'run-y', 'tok-y', [], []);
    expect(out).toContain('No skills are registered');
  });

  it('renderPromptTemplate renders a simple Liquid template', async () => {
    const result = await renderPromptTemplate('Hello {{ task.code }}!', {
      task: { code: 'T-999' },
    });
    expect(result).toBe('Hello T-999!');
  });

  it('renderPromptTemplate injects task variables', async () => {
    const result = await renderPromptTemplate(
      'Task: {{ task.title }} | Project: {{ project.name }}',
      { task: { title: 'My Task' }, project: { name: 'MyProj' } },
    );
    expect(result).toBe('Task: My Task | Project: MyProj');
  });

  it('renderPromptTemplate with undefined variable renders empty (strictVariables: false)', async () => {
    const result = await renderPromptTemplate('Value: {{ missing_var }}', {});
    expect(result).toBe('Value: ');
  });

  it('buildRolePrompt with templateOverride renders the override', async () => {
    const result = await buildRolePrompt(
      'pm',
      baseTask,
      baseProject,
      'run-4',
      'tok-4',
      [],
      'Run: {{ runId }} Task: {{ task.code }}',
    );
    expect(result).toBe('Run: run-4 Task: T-001');
  });

  it('buildRolePrompt with broken templateOverride falls back to default prompt', async () => {
    // A broken template that causes a parse error
    const result = await buildRolePrompt(
      'pm',
      baseTask,
      baseProject,
      'run-5',
      'tok-5',
      [],
      '{% invalid_tag_xyz %}',
    );
    // Should fall back to default prompt containing UPPER-CASED role
    expect(result).toContain('PM');
  });
});
