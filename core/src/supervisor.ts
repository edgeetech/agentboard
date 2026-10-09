// Ported from hatice src/supervisor.ts — OTP-like sliding-window crash recovery.

export interface SupervisorOptions {
  /** max restarts in window (default 5) */
  maxRestarts?: number;
  /** window size in ms (default 60000) */
  restartWindowMs?: number;
  /** health check interval ms (default 30000) */
  healthCheckIntervalMs?: number;
  onCrash?: (error: Error, restartCount: number) => void;
}

type RequiredOpts = Required<Omit<SupervisorOptions, 'onCrash'>> &
  Pick<SupervisorOptions, 'onCrash'>;

const DEFAULTS: RequiredOpts = {
  maxRestarts: 5,
  restartWindowMs: 60_000,
  healthCheckIntervalMs: 30_000,
};

export class Supervisor {
  #opts: RequiredOpts;
  #restartTimestamps: number[] = [];
  #stopped = false;
  #healthy = true;
  #healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(opts?: SupervisorOptions) {
    this.#opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Start the supervised function with crash recovery.
   */
  start(fn: () => Promise<void>): void {
    this.#stopped = false;
    this.#healthy = true;
    this.#restartTimestamps = [];
    this.#running = true;
    this.#startHealthCheck();
    this.#execute(fn);
  }

  stop(): void {
    this.#stopped = true;
    this.#running = false;
    this.#clearHealthCheck();
  }

  isHealthy(): boolean {
    return this.#healthy;
  }

  getRestartCount(): number {
    this.#pruneOldRestarts();
    return this.#restartTimestamps.length;
  }

  #execute(fn: () => Promise<void>): void {
    if (this.#stopped) return;
    fn().catch((error: unknown) => {
      if (this.#stopped) return;
      this.#pruneOldRestarts();
      const currentCount = this.#restartTimestamps.length;
      if (currentCount >= this.#opts.maxRestarts) {
        this.#healthy = false;
        this.#running = false;
        this.#clearHealthCheck();
        console.error('[supervisor] max restarts exceeded — stopping', {
          maxRestarts: this.#opts.maxRestarts,
        });
        return;
      }
      this.#restartTimestamps.push(Date.now());
      const restartCount = this.#restartTimestamps.length;
      this.#opts.onCrash?.(error instanceof Error ? error : new Error(String(error)), restartCount);
      setImmediate(() => {
        this.#execute(fn);
      });
    });
  }

  #pruneOldRestarts(): void {
    const windowStart = Date.now() - this.#opts.restartWindowMs;
    this.#restartTimestamps = this.#restartTimestamps.filter((ts) => ts > windowStart);
  }

  #startHealthCheck(): void {
    this.#clearHealthCheck();
    this.#healthCheckTimer = setInterval(() => {
      if (!this.#running || this.#stopped) this.#healthy = false;
    }, this.#opts.healthCheckIntervalMs);
    (this.#healthCheckTimer as unknown as { unref?: () => void }).unref?.();
  }

  #clearHealthCheck(): void {
    if (this.#healthCheckTimer !== null) {
      clearInterval(this.#healthCheckTimer);
      this.#healthCheckTimer = null;
    }
  }
}
