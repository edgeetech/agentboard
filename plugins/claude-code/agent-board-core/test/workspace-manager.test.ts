import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { WorkspaceManager } from '../src/workspace-manager.ts';

function makeTempRoot(): string {
  // Use a subdirectory of cwd instead of /tmp
  const root = join(process.cwd(), '.test-workspaces', randomUUID());
  mkdirSync(root, { recursive: true });
  return root;
}

describe('WorkspaceManager', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rmSync } = await import('node:fs');
    for (const r of roots) {
      try {
        rmSync(r, { recursive: true, force: true });
      } catch (e) {
        // best-effort cleanup; ignore errors
        void e;
      }
    }
    roots.length = 0;
  });

  it('ensureWorkspace creates a directory for the task ID', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    const wsPath = await wm.ensureWorkspace('task-123');
    expect(existsSync(wsPath)).toBe(true);
  });

  it('getPath returns the expected directory path', () => {
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    const p = wm.getPath('task-abc');
    expect(p).toContain('task-abc');
    expect(p).toContain(root);
  });

  it('ensureWorkspace twice returns same path', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    const p1 = await wm.ensureWorkspace('my-task');
    const p2 = await wm.ensureWorkspace('my-task');
    expect(p1).toBe(p2);
  });

  it('removeWorkspace deletes the directory', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    await wm.ensureWorkspace('del-task');
    const wsPath = wm.getPath('del-task');
    expect(existsSync(wsPath)).toBe(true);
    await wm.removeWorkspace('del-task');
    expect(existsSync(wsPath)).toBe(false);
  });

  it('sanitize replaces unsafe characters', () => {
    expect(WorkspaceManager.sanitize('a/b\\c:d')).not.toContain('/');
    expect(WorkspaceManager.sanitize('a/b\\c:d')).not.toContain('\\');
    expect(WorkspaceManager.sanitize('')).toBe('_');
  });

  it('path traversal is rejected', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    // ensureWorkspace('..')  → sanitize preserves '..' → getPath returns join(root, '..')
    // → #validatePathSafety detects path escapes root and throws
    await expect(wm.ensureWorkspace('..')).rejects.toThrow(/escapes workspace root/);
  });
});
