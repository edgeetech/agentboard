// Per-task workspace isolation. Creates a dedicated temp directory per task,
// runs lifecycle hooks, and cleans artifact caches between runs.
// Security: validates paths to prevent traversal + symlink escapes.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { homedir } from 'node:os';

const ARTIFACT_DIRS = [
  '.cache',
  'node_modules/.cache',
  'tmp',
  '.tmp',
  '.vite',
  '.turbo',
  '.next/cache',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
];

export class Workspace {
  /**
   * @param {string} rootDir  Base directory (all workspaces live under here)
   * @param {object} hooks    { afterCreate, beforeRun, afterRun, beforeRemove, timeoutMs }
   */
  constructor(rootDir, hooks = {}) {
    this.rootDir = resolve(rootDir);
    this.hooks = {
      afterCreate:   hooks.afterCreate   ?? null,
      beforeRun:     hooks.beforeRun     ?? null,
      afterRun:      hooks.afterRun      ?? null,
      beforeRemove:  hooks.beforeRemove  ?? null,
      timeoutMs:     hooks.timeoutMs     ?? 60_000,
    };
  }

  static sanitizeIdentifier(id) {
    return id.replace(/[^A-Za-z0-9._-]/g, '_') || '_';
  }

  static defaultRoot(projectCode) {
    return join(homedir(), '.agentboard', 'workspaces', projectCode);
  }

  getWorkspacePath(taskCode) {
    return join(this.rootDir, Workspace.sanitizeIdentifier(taskCode));
  }

  validatePathSafety(targetPath) {
    const resolved = resolve(targetPath);
    const rel = relative(this.rootDir, resolved);
    if (rel.startsWith('..') || resolve(this.rootDir, rel) !== resolved) {
      throw new Error(`workspace: path escapes root: ${targetPath}`);
    }
    // Walk each segment and reject symlinks
    const segments = rel.split(/[\\/]/).filter(Boolean);
    let current = this.rootDir;
    for (const seg of segments) {
      current = join(current, seg);
      try {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error(`workspace: symlink detected: ${current}`);
      } catch (e) {
        if (e.code === 'ENOENT') break; // doesn't exist yet — fine for creation
        throw e;
      }
    }
  }

  /**
   * Ensure workspace directory exists. Runs afterCreate hook on new dirs.
   * Cleans artifact caches on existing dirs.
   * Returns the workspace path.
   */
  async ensureWorkspace(taskCode, context = {}) {
    const wsPath = this.getWorkspacePath(taskCode);
    this.validatePathSafety(wsPath);

    const isNew = !existsSync(wsPath);
    mkdirSync(wsPath, { recursive: true });

    if (isNew && this.hooks.afterCreate) {
      await this.runHook('afterCreate', this.hooks.afterCreate, wsPath, context);
    } else if (!isNew) {
      this.cleanArtifacts(wsPath);
    }

    if (this.hooks.beforeRun) {
      await this.runHook('beforeRun', this.hooks.beforeRun, wsPath, context);
    }

    return wsPath;
  }

  cleanArtifacts(wsPath) {
    for (const dir of ARTIFACT_DIRS) {
      const target = join(wsPath, dir);
      try {
        rmSync(target, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
  }

  async afterRun(taskCode, context = {}) {
    if (!this.hooks.afterRun) return;
    const wsPath = this.getWorkspacePath(taskCode);
    try {
      await this.runHook('afterRun', this.hooks.afterRun, wsPath, context);
    } catch (e) {
      console.warn('[workspace] afterRun hook failed (non-fatal):', e?.message || e);
    }
  }

  async removeWorkspace(taskCode, context = {}) {
    const wsPath = this.getWorkspacePath(taskCode);
    this.validatePathSafety(wsPath);
    if (this.hooks.beforeRemove) {
      try {
        await this.runHook('beforeRemove', this.hooks.beforeRemove, wsPath, context);
      } catch (e) {
        console.warn('[workspace] beforeRemove hook failed (continuing):', e?.message || e);
      }
    }
    rmSync(wsPath, { recursive: true, force: true });
  }

  runHook(hookName, command, wsPath, context) {
    return new Promise((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'cmd' : 'sh';
      const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-lc', command];
      const child = spawn(shell, shellArgs, {
        cwd: wsPath,
        env: {
          ...process.env,
          AGENTBOARD_TASK_CODE:  context.taskCode  ?? '',
          AGENTBOARD_TASK_ID:    context.taskId    ?? '',
          AGENTBOARD_WORKSPACE:  wsPath,
          AGENTBOARD_REPO_PATH:  context.repoPath  ?? '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => { stdout += d.toString(); });
      child.stderr?.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`workspace hook '${hookName}' timed out after ${this.hooks.timeoutMs}ms`));
      }, this.hooks.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout.slice(0, 2048));
        else reject(new Error(`workspace hook '${hookName}' exit ${code}: ${stderr.slice(0, 512)}`));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`workspace hook '${hookName}' spawn failed: ${err.message}`));
      });
    });
  }
}
