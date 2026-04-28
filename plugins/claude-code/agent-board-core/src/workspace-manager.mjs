// Per-task temp dir isolation. Workspaces live under dataDir()/workspaces/<taskId>/

import { mkdirSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { dataDir } from './paths.mjs';

const ARTIFACT_DIRS = ['.cache', 'node_modules/.cache', 'tmp', '.tmp', '.vite', '.turbo', '.next/cache', '.nuxt'];

export class WorkspaceManager {
  #rootDir;
  #hooks;

  /**
   * @param {string} [rootDir]  base dir (defaults to ~/.agentboard/workspaces)
   * @param {{afterCreate?:string, beforeRun?:string, afterRun?:string, beforeRemove?:string, timeoutMs?:number}} [hooks]
   */
  constructor(rootDir, hooks = {}) {
    this.#rootDir = rootDir ?? join(dataDir(), 'workspaces');
    this.#hooks = { timeoutMs: 30_000, ...hooks };
    mkdirSync(this.#rootDir, { recursive: true });
  }

  static sanitize(id) {
    return id.replace(/[^A-Za-z0-9._-]/g, '_') || '_';
  }

  getPath(taskId) {
    return join(this.#rootDir, WorkspaceManager.sanitize(taskId));
  }

  /**
   * Ensure workspace exists, run afterCreate hook if newly created.
   * @param {string} taskId
   * @param {string} [taskCode]
   * @returns {Promise<string>} workspace path
   */
  async ensureWorkspace(taskId, taskCode) {
    const wsPath = this.getPath(taskId);
    this.#validatePathSafety(wsPath);

    const isNew = !existsSync(wsPath);
    mkdirSync(wsPath, { recursive: true });

    if (isNew && this.#hooks.afterCreate) {
      await this.#runHook('afterCreate', this.#hooks.afterCreate, wsPath, { taskId, taskCode: taskCode ?? taskId });
    } else if (!isNew) {
      this.#cleanArtifacts(wsPath);
    }

    return wsPath;
  }

  async beforeRun(taskId, taskCode) {
    const wsPath = this.getPath(taskId);
    if (this.#hooks.beforeRun) {
      await this.#runHook('beforeRun', this.#hooks.beforeRun, wsPath, { taskId, taskCode: taskCode ?? taskId });
    }
  }

  async afterRun(taskId, taskCode) {
    const wsPath = this.getPath(taskId);
    if (this.#hooks.afterRun) {
      try {
        await this.#runHook('afterRun', this.#hooks.afterRun, wsPath, { taskId, taskCode: taskCode ?? taskId });
      } catch (e) {
        console.warn('[workspace] afterRun hook failed (non-fatal):', e?.message);
      }
    }
  }

  async removeWorkspace(taskId, taskCode) {
    const wsPath = this.getPath(taskId);
    this.#validatePathSafety(wsPath);

    if (this.#hooks.beforeRemove) {
      try {
        await this.#runHook('beforeRemove', this.#hooks.beforeRemove, wsPath, { taskId, taskCode: taskCode ?? taskId });
      } catch (e) {
        console.warn('[workspace] beforeRemove hook failed (continuing):', e?.message);
      }
    }

    try { rmSync(wsPath, { recursive: true, force: true }); } catch {}
  }

  #validatePathSafety(wsPath) {
    const resolved = resolve(wsPath);
    const rel = relative(this.#rootDir, resolved);
    if (rel.startsWith('..') || resolve(this.#rootDir, rel) !== resolved) {
      throw new Error(`Path escapes workspace root: ${wsPath}`);
    }
    try {
      const segments = rel.split(/[\\/]/);
      let cur = this.#rootDir;
      for (const seg of segments) {
        cur = join(cur, seg);
        if (!existsSync(cur)) break;
        if (lstatSync(cur).isSymbolicLink()) throw new Error(`Symlink in path: ${cur}`);
      }
    } catch (e) {
      if (e.message?.startsWith('Symlink') || e.message?.startsWith('Path')) throw e;
    }
  }

  #cleanArtifacts(wsPath) {
    for (const dir of ARTIFACT_DIRS) {
      try { rmSync(join(wsPath, dir), { recursive: true, force: true }); } catch {}
    }
  }

  #runHook(hookName, command, wsPath, context) {
    const timeoutMs = this.#hooks.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const [bin, ...cmdArgs] = process.platform === 'win32'
        ? ['cmd', '/c', command]
        : ['sh', '-lc', command];

      const child = spawn(bin, cmdArgs, {
        cwd: wsPath,
        env: {
          ...process.env,
          AGENTBOARD_TASK_ID: context.taskId,
          AGENTBOARD_TASK_CODE: context.taskCode,
          AGENTBOARD_WORKSPACE: wsPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', d => { stdout += d.toString(); });
      child.stderr?.on('data', d => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Hook '${hookName}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout.slice(0, 2048));
        else reject(new Error(`Hook '${hookName}' exited ${code}: ${stderr.slice(0, 512)}`));
      });
      child.on('error', err => { clearTimeout(timer); reject(err); });
    });
  }
}

/** Process-level singleton workspace manager (no hooks by default). */
export const workspaceManager = new WorkspaceManager();
