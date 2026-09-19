import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openProjectDb } from '../src/db.ts';
import { createProject, getProject, updateProject } from '../src/repo.ts';

let tempRoot: string | null = null;

afterEach(() => {
  if (tempRoot !== null) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe('legacy project persistence compatibility', () => {
  it('maps project rows and preserves optimistic updates through the SQLite adapter', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'agentboard-persistence-'));
    const db = await openProjectDb(join(tempRoot, 'project.sqlite'));
    try {
      const created = createProject(db, {
        code: 'P1',
        name: 'Project',
        workflow_type: 'WF1',
        repo_path: '/tmp/project',
        agent_provider: 'claude',
      });
      expect(getProject(db)).toMatchObject({
        id: created.id,
        workflow_type: 'WF1',
        repo_path: '/tmp/project',
        allow_git: 0,
      });

      const updated = updateProject(
        db,
        { name: 'Updated', scan_ignore_json: ['dist', '.cache'] },
        created.version,
      );
      expect(updated).toMatchObject({
        ok: true,
        project: {
          name: 'Updated',
          scan_ignore_json: '["dist",".cache"]',
          version: created.version + 1,
        },
      });
      expect(updateProject(db, { name: 'Stale' }, created.version)).toEqual({
        ok: false,
        reason: 'version mismatch',
      });
    } finally {
      db.close();
    }
  });
});
