// Ported from hatice src/session-logger.ts — Pino NDJSON per-run log files.

import pino from 'pino';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logsDir } from './paths.mjs';

/**
 * Manages per-run Pino NDJSON log files.
 * Log files are written to ~/.agentboard/logs/<run_id>.ndjson
 */
export class SessionLogger {
  /** @type {string} */
  #logDir;
  /** @type {Map<string, {logger:import('pino').Logger, logPath:string, destination:import('pino').DestinationStream}>} */
  #sessions = new Map();

  /** @param {string} [logDir] */
  constructor(logDir) {
    this.#logDir = logDir ?? logsDir();
    mkdirSync(this.#logDir, { recursive: true });
  }

  /**
   * Create a new per-run session log.
   * @param {string} runId
   * @returns {{info:Function, error:Function, warn:Function}}
   */
  createSessionLog(runId) {
    this.closeSessionLog(runId);
    const logPath = join(this.#logDir, `${runId}.ndjson`);
    const destination = pino.destination({ dest: logPath, sync: true });
    const logger = pino({ name: `run-${runId}` }, destination);
    this.#sessions.set(runId, { logger, logPath, destination });
    return logger;
  }

  /**
   * Close and remove the session log for a run.
   * @param {string} runId
   */
  closeSessionLog(runId) {
    const entry = this.#sessions.get(runId);
    if (!entry) return;
    try { entry.destination.flushSync?.(); } catch {}
    try { entry.destination.end?.(); } catch {}
    this.#sessions.delete(runId);
  }

  /**
   * Get the log file path for an active run session.
   * @param {string} runId
   * @returns {string|null}
   */
  getLogPath(runId) {
    return this.#sessions.get(runId)?.logPath ?? null;
  }

  cleanup() {
    for (const runId of [...this.#sessions.keys()]) {
      this.closeSessionLog(runId);
    }
  }
}

/** Process-level singleton session logger. */
export const sessionLogger = new SessionLogger();
