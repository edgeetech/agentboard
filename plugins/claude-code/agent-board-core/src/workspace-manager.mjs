// Ported from hatice src/workspace.ts — per-task temp dir isolation.
// agentboard: workspace is created under dataDir()/workspaces/<task_id>/

import { mkdirSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { dataDir } from './paths.mjs';

const ARTIFACT_DIRS = ['.cache', 'node_modules/.cache', 'tmp', '.tmp', '.vite', '.turbo', '.next/cache', '.nuxt'];

/**
 * @typedef {Object} HooksConfig
 * @property {string} [afterCreate]    shell command to run after workspace creation
 * @property {string} [beforeRun]      shell command to run before agent run
 * @property {string} [afterRun]       shell command to run after agent run
 * @property {string} [beforeRemove]   shell command to run before workspace removal
 * @property {number} [timeoutMs]      hook timeout in ms (default 30000)
 */

export class WorkspaceManager {
  #rootDir;
  /** @type {HooksConfig} */
  #hooks;

  /**
   * @param {string} [rootDir]   base dir for workspaces (defaults to ~/.agentboard/workspaces)
   * @param {HooksConfig} [hooks]
   */
  constructor(rootDir, hooks = {}) {
    this.#rootDir = rootDir ?? join(dataDir(), 'workspaces');
    this.#hooks = { timeoutMs: 30_000, ...hooks };
    mkdirSync(this.#rootDir, { recursive: true });
  }

  /**
   * Sanitize a task id for use as directory name.
   * @param {string} id
   * @returns {string}
   */
  static sanitize(id) {
    return id.replace(/[^A-Za-z0-9._-]/g, '_') || '_';
  }

  /**
   * Get the workspace path for a task (does NOT create it).
   * @param {string} taskId
   * @returns {string}
   */
  getPath(taskId) {
    return join(this.#rootDir, WorkspaceManager.sanitize(taskId));
  }

  /**
   * Ensure workspace exists, running afterCreate hook if newly created.
   * @param {string} taskId
   * @param {string} [taskCode]   human-readable code for hook env
   * @returns {string}            workspace path
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

  /**
   * Run beforeRun hook.
   * @param {string} taskId
   * @param {string} [taskCode]
   */
  async beforeRun(taskId, taskCode) {
    const wsPath = this.getPath(taskId);
    if (this.#hooks.beforeRun) {
      await this.#runHook('beforeRun', this.#hooks.beforeRun, wsPath, { taskId, taskCode: taskCode ?? taskId });
    }
  }

  /**
   * Run afterRun hook.
   * @param {string} taskId
   * @param {string} [taskCode]
   */
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

  /**
   * Remove a workspace, running beforeRemove hook first.
   * @param {string} taskId
   * @param {string} [taskCode]
   */
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

  /** @param {string} wsPath */
  #validatePathSafety(wsPath) {
    const resolved = resolve(wsPath);
    const rel = relative(this.#rootDir, resolved);
    if (rel.startsWith('..') || resolve(this.#rootDir, rel) !== resolved) {
      throw new Error(`Path escapes workspace root: ${wsPath}`);
    }
    // Symlink check
    try {
      const segments = rel.split(/[\\/]/);
      let cur = this.#rootDir;
      for (const seg of segments) {
        cur = join(cur, seg);
        try {
          if (!existsSync(cur)) break;
          if (lstatSync(cur).isSymbolicLink()) throw new Error(`Symlink in path: ${cur}`);
        } catch (e) {
          // Only ignore ENOENT while traversing; rethrow other errors (permissions, IO, etc.)
          if (e?.code === 'ENOENT') break;
          throw e;
        }
      }
    } catch (e) {
      if (e?.message?.startsWith('Symlink') || e?.message?.startsWith('Path')) throw e;
      throw e;
    }
  }

  /** @param {string} wsPath */
  #cleanArtifacts(wsPath) {
    for (const dir of ARTIFACT_DIRS) {
      try { rmSync(join(wsPath, dir), { recursive: true, force: true }); } catch {}
    }
  }

  /**
   * @param {string} hookName
   * @param {string} command
   * @param {string} wsPath
   * @param {{taskId:string, taskCode:string}} context
   * @returns {Promise<string>}
   */
  #runHook(hookName, command, wsPath, context) {
    const timeoutMs = this.#hooks.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      // Use cmd /c on Windows, sh -lc on Unix
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
        detached: false,  // On Windows, true would create orphan process; keep false and manage cleanup
        windowsHide: true,  // Hide window on Windows
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
