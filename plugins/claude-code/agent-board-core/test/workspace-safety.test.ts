import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { WorkspaceManager } from '../src/workspace-manager.ts';

function makeTempRoot(): string {
  const root = join(process.cwd(), '.test-workspaces', randomUUID());
  mkdirSync(root, { recursive: true });
  return root;
}

describe('WorkspaceManager – path safety', () => {
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

  it('rejects a path that escapes the root via ..', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    // sanitize() preserves dots so '..' stays '..'; directory separators are stripped.
    // The traversal guard in #validatePathSafety (not sanitize) is what rejects escaped paths.
    // Verify that ensureWorkspace actually rejects when a path tries to escape root
    await expect(wm.ensureWorkspace('..')).rejects.toThrow(/escapes workspace root/);
  });

  it('workspace path is always inside rootDir', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    const wsPath = await wm.ensureWorkspace('safe-task');
    expect(wsPath.startsWith(root)).toBe(true);
  });

  it('rejects symlink in workspace path (if symlinks are supported)', async () => {
    const root = makeTempRoot();
    roots.push(root);

    // Create a real dir outside root, then symlink inside root to it
    const outsideDir = join(process.cwd(), '.test-workspaces', `outside-${randomUUID()}`);
    roots.push(outsideDir);
    mkdirSync(outsideDir, { recursive: true });

    const symlinkPath = join(root, 'link');
    try {
      symlinkSync(outsideDir, symlinkPath, 'junction');
    } catch {
      // Symlinks may require elevated privileges on Windows — skip gracefully
      return;
    }

    const wm = new WorkspaceManager(root);
    // WorkspaceManager.sanitize turns 'link' into 'link'; wsPath = root/link
    // ensureWorkspace should detect the symlink and throw
    await expect(wm.ensureWorkspace('link')).rejects.toThrow(/symlink/i);
  });

  it('sanitize prevents directory separators in ID', () => {
    // sanitize replaces / and \ (and other unsafe chars) with _
    // Note: dots (.) are preserved because they match [A-Za-z0-9._-]
    // Traversal safety relies on #validatePathSafety (path resolution), not sanitize alone
    const sanitized = WorkspaceManager.sanitize('../../../etc/passwd');
    expect(sanitized).not.toContain('/');
    expect(sanitized).not.toContain('\\');
    // The actual wsPath built from sanitized ID must still be inside root
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    const wsPath = wm.getPath('../../../etc/passwd');
    expect(wsPath.startsWith(root)).toBe(true);
  });

  it('cleans artifact dirs on existing workspace', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const wm = new WorkspaceManager(root);
    await wm.ensureWorkspace('clean-task');
    const wsPath = wm.getPath('clean-task');

    // Create an artifact dir inside workspace
    const cacheDir = join(wsPath, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'junk.txt'), 'dirty');
    expect(existsSync(cacheDir)).toBe(true);

    // ensureWorkspace again triggers cleanArtifacts (not isNew)
    await wm.ensureWorkspace('clean-task');
    expect(existsSync(cacheDir)).toBe(false);
  });

  it('afterCreate hook fires only once on new workspace', async () => {
    const root = makeTempRoot();
    roots.push(root);
    // Hook writes marker.txt relative to the workspace dir (no absolute path quoting needed)
    const hookCmd = process.platform === 'win32' ? `echo ran > marker.txt` : `touch marker.txt`;
    const wm = new WorkspaceManager(root, { afterCreate: hookCmd });

    await wm.ensureWorkspace('hook-task');
    const wsPath = wm.getPath('hook-task');
    const marker = join(wsPath, 'marker.txt');
    expect(existsSync(marker)).toBe(true);

    // Re-run — hook must NOT fire again (cleanArtifacts path, not isNew)
    const { mtimeMs: t1 } = await import('node:fs').then((m) => m.statSync(marker));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    await wm.ensureWorkspace('hook-task');
    const { mtimeMs: t2 } = await import('node:fs').then((m) => m.statSync(marker));
    expect(t2).toBe(t1);
  });
});
