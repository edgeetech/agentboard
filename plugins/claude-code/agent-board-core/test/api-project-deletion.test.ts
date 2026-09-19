import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteProjectData } from '../src/api-projects.ts';
import { readConfig, writeConfig } from '../src/config.ts';
import { ensureDirs, projectDbPath, trashDir } from '../src/paths.ts';
import { closeDb, getDb, listProjectDbs, openOrCreate } from '../src/project-registry.ts';
import { createProject, createTask } from '../src/repo.ts';

describe('project deletion', () => {
  let root: string;
  let dataDir: string;
  let sessionsDir: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentboard-delete-'));
    dataDir = join(root, 'agentboard-data');
    sessionsDir = join(root, 'sessions');
    repoA = join(root, 'repo-a');
    repoB = join(root, 'repo-b');
    process.env.AGENTBOARD_DATA_DIR = dataDir;
    process.env.AGENTBOARD_SESSION_DIR = sessionsDir;
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    ensureDirs();
  });

  afterEach(() => {
    closeDb('AAA');
    closeDb('BBB');
    delete process.env.AGENTBOARD_DATA_DIR;
    delete process.env.AGENTBOARD_SESSION_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('removes the project graph and linked sessions, preserves the repo, and selects a fallback', async () => {
    const sentinel = join(repoA, 'keep-me.txt');
    const sentinelContent = 'repository content must survive\n';
    writeFileSync(sentinel, sentinelContent);

    const dbA = await openOrCreate('AAA');
    createProject(dbA, {
      code: 'AAA',
      name: 'Delete me',
      workflow_type: 'WF1',
      repo_path: repoA,
    });
    const created = createTask(dbA, { title: 'Owned task', assignee_role: 'worker' });
    expect(created.task).toBeDefined();
    expect(created.runId).not.toBeNull();
    if (!created.task || !created.runId) throw new Error('expected task and run');
    dbA
      .prepare(
        "INSERT INTO comment(id, task_id, author_role, body, created_at) VALUES ('c1', ?, 'human', 'owned comment', CURRENT_TIMESTAMP)",
      )
      .run(created.task.id);
    dbA
      .prepare('UPDATE agent_run SET session_id=?, claude_session_id=? WHERE id=?')
      .run('linked-session', 'linked-session', created.runId);

    const dbB = await openOrCreate('BBB');
    createProject(dbB, {
      code: 'BBB',
      name: 'Fallback',
      workflow_type: 'WF1',
      repo_path: repoB,
    });
    writeConfig({ active_project_code: 'AAA' });

    const sessionDbPath = join(sessionsDir, 'recordings.db');
    const sessions = new DatabaseSync(sessionDbPath);
    sessions.exec(`
      CREATE TABLE session_meta (session_id TEXT PRIMARY KEY, project_dir TEXT);
      CREATE TABLE session_events (id INTEGER PRIMARY KEY, session_id TEXT, data TEXT);
      CREATE TABLE session_resume (session_id TEXT PRIMARY KEY, snapshot TEXT);
      INSERT INTO session_meta VALUES ('linked-session', '${repoA.replaceAll("'", "''")}');
      INSERT INTO session_meta VALUES ('unrelated-session', '${repoB.replaceAll("'", "''")}');
      INSERT INTO session_events(session_id, data) VALUES ('linked-session', 'event');
      INSERT INTO session_events(session_id, data) VALUES ('unrelated-session', 'event');
      INSERT INTO session_resume VALUES ('linked-session', 'resume');
    `);
    sessions.close();

    const result = await deleteProjectData('AAA');

    expect(result.deletedSessions).toBe(1);
    expect(result.activeProjectCode).toBe('BBB');
    expect(readConfig().active_project_code).toBe('BBB');
    expect(listProjectDbs()).toEqual(['bbb']);
    await expect(getDb('AAA')).rejects.toThrow(/not found/);
    expect(existsSync(projectDbPath('aaa'))).toBe(false);
    expect(readdirSync(trashDir()).some((name) => name.startsWith('aaa-'))).toBe(true);

    const remainingSessions = new DatabaseSync(sessionDbPath, { readOnly: true });
    expect(
      remainingSessions.prepare('SELECT session_id FROM session_meta ORDER BY session_id').all(),
    ).toEqual([{ session_id: 'unrelated-session' }]);
    expect(
      remainingSessions.prepare('SELECT session_id FROM session_events ORDER BY session_id').all(),
    ).toEqual([{ session_id: 'unrelated-session' }]);
    expect(remainingSessions.prepare('SELECT * FROM session_resume').all()).toEqual([]);
    remainingSessions.close();

    expect(readFileSync(sentinel, 'utf8')).toBe(sentinelContent);
    expect(existsSync(repoA)).toBe(true);
  });

  it('leaves the active selection unchanged when deleting a different project', async () => {
    const dbA = await openOrCreate('AAA');
    createProject(dbA, {
      code: 'AAA',
      name: 'Active',
      workflow_type: 'WF1',
      repo_path: repoA,
    });
    const dbB = await openOrCreate('BBB');
    createProject(dbB, {
      code: 'BBB',
      name: 'Delete me',
      workflow_type: 'WF1',
      repo_path: repoB,
    });
    writeConfig({ active_project_code: 'AAA' });

    const result = await deleteProjectData('BBB');

    expect(result.activeProjectCode).toBe('AAA');
    expect(readConfig().active_project_code).toBe('AAA');
    expect(listProjectDbs()).toEqual(['aaa']);
  });
});
