// Ported from hatice src/workspace.ts — per-task temp dir isolation.
// agentboard: workspace is created under dataDir()/workspaces/<task_id>/

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

import { dataDir } from './paths.ts';

const ARTIFACT_DIRS = [
  '.cache',
  'node_modules/.cache',
  'tmp',
  '.tmp',
  '.vite',
  '.turbo',
  '.next/cache',
  '.nuxt',
];

export interface HooksConfig {
  /** shell command to run after workspace creation */
  afterCreate?: string;
  /** shell command to run before agent run */
  beforeRun?: string;
  /** shell command to run after agent run */
  afterRun?: string;
  /** shell command to run before workspace removal */
  beforeRemove?: string;
  /** hook timeout in ms (default 30000) */
  timeoutMs?: number;
}

export class WorkspaceManager {
  #rootDir: string;
  #hooks: HooksConfig;

  /**
   * @param rootDir  base dir for workspaces (defaults to ~/.agentboard/workspaces)
   */
  constructor(rootDir?: string, hooks: HooksConfig = {}) {
    this.#rootDir = rootDir ?? join(dataDir(), 'workspaces');
    this.#hooks = { timeoutMs: 30_000, ...hooks };
    mkdirSync(this.#rootDir, { recursive: true });
  }

  /**
   * Sanitize a task id for use as directory name.
   */
  static sanitize(id: string): string {
    return id.replace(/[^A-Za-z0-9._-]/g, '_') || '_';
  }

  /**
   * Get the workspace path for a task (does NOT create it).
   */
  getPath(taskId: string): string {
    return join(this.#rootDir, WorkspaceManager.sanitize(taskId));
  }

  /**
   * Ensure workspace exists, running afterCreate hook if newly created.
   * @returns workspace path
   */
  async ensureWorkspace(taskId: string, taskCode?: string): Promise<string> {
    const wsPath = this.getPath(taskId);
    this.#validatePathSafety(wsPath);

    const isNew = !existsSync(wsPath);
    mkdirSync(wsPath, { recursive: true });

    if (isNew && this.#hooks.afterCreate) {
      await this.#runHook('afterCreate', this.#hooks.afterCreate, wsPath, {
        taskId,
        taskCode: taskCode ?? taskId,
      });
    } else if (!isNew) {
      this.#cleanArtifacts(wsPath);
    }

    return wsPath;
  }

  /**
   * Run beforeRun hook.
   */
  async beforeRun(taskId: string, taskCode?: string): Promise<void> {
    const wsPath = this.getPath(taskId);
    if (this.#hooks.beforeRun) {
      await this.#runHook('beforeRun', this.#hooks.beforeRun, wsPath, {
        taskId,
        taskCode: taskCode ?? taskId,
      });
    }
  }

  /**
   * Run afterRun hook.
   */
  async afterRun(taskId: string, taskCode?: string): Promise<void> {
    const wsPath = this.getPath(taskId);
    if (this.#hooks.afterRun) {
      try {
        await this.#runHook('afterRun', this.#hooks.afterRun, wsPath, {
          taskId,
          taskCode: taskCode ?? taskId,
        });
      } catch (e) {
        console.warn(
          '[workspace] afterRun hook failed (non-fatal):',
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  /**
   * Remove a workspace, running beforeRemove hook first.
   */
  async removeWorkspace(taskId: string, taskCode?: string): Promise<void> {
    const wsPath = this.getPath(taskId);
    this.#validatePathSafety(wsPath);

    if (this.#hooks.beforeRemove) {
      try {
        await this.#runHook('beforeRemove', this.#hooks.beforeRemove, wsPath, {
          taskId,
          taskCode: taskCode ?? taskId,
        });
      } catch (e) {
        console.warn(
          '[workspace] beforeRemove hook failed (continuing):',
          e instanceof Error ? e.message : e,
        );
      }
    }

    try {
      rmSync(wsPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  #validatePathSafety(wsPath: string): void {
    const resolved = resolve(wsPath);
    const rel = relative(this.#rootDir, resolved);
    if (rel.startsWith('..') || resolve(this.#rootDir, rel) !== resolved) {
      throw new Error(`Path escapes workspace root: ${wsPath}`);
    }
    // Symlink check
    const segments = rel.split(/[\\/]/);
    let cur = this.#rootDir;
    for (const seg of segments) {
      cur = join(cur, seg);
      if (!existsSync(cur)) break;
      try {
        if (lstatSync(cur).isSymbolicLink()) throw new Error(`Symlink in path: ${cur}`);
      } catch (e) {
        // Only ignore ENOENT while traversing; rethrow other errors (permissions, IO, etc.)
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw e;
      }
    }
  }

  #cleanArtifacts(wsPath: string): void {
    for (const dir of ARTIFACT_DIRS) {
      try {
        rmSync(join(wsPath, dir), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  #runHook(
    hookName: string,
    command: string,
    wsPath: string,
    context: { taskId: string; taskCode: string },
  ): Promise<string> {
    const timeoutMs = this.#hooks.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      // Use cmd /c on Windows, sh -lc on Unix
      const argv = process.platform === 'win32' ? ['cmd', '/c', command] : ['sh', '-lc', command];
      // argv is always length >= 2, so argv[0] is defined
      const bin = argv[0] ?? 'sh';
      const cmdArgs = argv.slice(1);

      const child = spawn(bin, cmdArgs, {
        cwd: wsPath,
        env: {
          ...process.env,
          AGENTBOARD_TASK_ID: context.taskId,
          AGENTBOARD_TASK_CODE: context.taskCode,
          AGENTBOARD_WORKSPACE: wsPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false, // On Windows, true would create orphan process; keep false and manage cleanup
        windowsHide: true, // Hide window on Windows
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Hook '${hookName}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout.slice(0, 2048));
        else
          reject(new Error(`Hook '${hookName}' exited ${String(code)}: ${stderr.slice(0, 512)}`));
      });
      child.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}

/** Process-level singleton workspace manager (no hooks by default). */
export const workspaceManager = new WorkspaceManager();
