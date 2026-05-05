// Ported from hatice src/session-logger.ts — Pino NDJSON per-run log files.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import pino from 'pino';

import { logsDir } from './paths.ts';

interface SessionEntry {
  logger: pino.Logger;
  logPath: string;
  destination: pino.DestinationStream;
}

/**
 * Manages per-run Pino NDJSON log files.
 * Log files are written to ~/.agentboard/logs/<run_id>.ndjson
 */
export class SessionLogger {
  #logDir: string;
  #sessions = new Map<string, SessionEntry>();

  constructor(logDir?: string) {
    this.#logDir = logDir ?? logsDir();
    mkdirSync(this.#logDir, { recursive: true });
  }

  /**
   * Create a new per-run session log.
   */
  createSessionLog(runId: string): pino.Logger {
    this.closeSessionLog(runId);
    const logPath = join(this.#logDir, `${runId}.ndjson`);
    const destination = pino.destination({ dest: logPath, sync: true });
    const logger = pino({ name: `run-${runId}` }, destination);
    this.#sessions.set(runId, { logger, logPath, destination });
    return logger;
  }

  /**
   * Close and remove the session log for a run.
   */
  closeSessionLog(runId: string): void {
    const entry = this.#sessions.get(runId);
    if (!entry) return;
    try {
      const d = entry.destination as unknown as { flushSync?: () => void; end?: () => void };
      d.flushSync?.();
    } catch {
      /* best-effort flush */
    }
    try {
      const d = entry.destination as unknown as { end?: () => void };
      d.end?.();
    } catch {
      /* best-effort close */
    }
    this.#sessions.delete(runId);
  }

  /**
   * Get the log file path for an active run session.
   */
  getLogPath(runId: string): string | null {
    return this.#sessions.get(runId)?.logPath ?? null;
  }

  cleanup(): void {
    for (const runId of [...this.#sessions.keys()]) {
      this.closeSessionLog(runId);
    }
  }
}

/** Process-level singleton session logger. */
export const sessionLogger = new SessionLogger();
