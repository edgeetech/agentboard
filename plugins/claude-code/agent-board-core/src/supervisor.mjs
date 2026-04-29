// Ported from hatice src/supervisor.ts — OTP-like sliding-window crash recovery.

/**
 * @typedef {Object} SupervisorOptions
 * @property {number} [maxRestarts]          - max restarts in window (default 5)
 * @property {number} [restartWindowMs]      - window size in ms (default 60000)
 * @property {number} [healthCheckIntervalMs] - health check interval ms (default 30000)
 * @property {(error:Error, restartCount:number)=>void} [onCrash]
 */

const DEFAULTS = {
  maxRestarts: 5,
  restartWindowMs: 60_000,
  healthCheckIntervalMs: 30_000,
};

export class Supervisor {
  /** @type {Required<Omit<SupervisorOptions,'onCrash'>> & Pick<SupervisorOptions,'onCrash'>} */
  #opts;
  #restartTimestamps = [];
  #stopped = false;
  #healthy = true;
  #healthCheckTimer = null;
  #running = false;

  /** @param {SupervisorOptions} [opts] */
  constructor(opts) {
    this.#opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Start the supervised function with crash recovery.
   * @param {()=>Promise<void>} fn
   */
  start(fn) {
    this.#stopped = false;
    this.#healthy = true;
    this.#restartTimestamps = [];
    this.#running = true;
    this.#startHealthCheck();
    this.#execute(fn);
  }

  stop() {
    this.#stopped = true;
    this.#running = false;
    this.#clearHealthCheck();
  }

  isHealthy() { return this.#healthy; }

  getRestartCount() {
    this.#pruneOldRestarts();
    return this.#restartTimestamps.length;
  }

  /** @param {()=>Promise<void>} fn */
  #execute(fn) {
    if (this.#stopped) return;
    fn().catch((error) => {
      if (this.#stopped) return;
      this.#pruneOldRestarts();
      const currentCount = this.#restartTimestamps.length;
      if (currentCount >= this.#opts.maxRestarts) {
        this.#healthy = false;
        this.#running = false;
        this.#clearHealthCheck();
        console.error('[supervisor] max restarts exceeded — stopping', { maxRestarts: this.#opts.maxRestarts });
        return;
      }
      this.#restartTimestamps.push(Date.now());
      const restartCount = this.#restartTimestamps.length;
      this.#opts.onCrash?.(error instanceof Error ? error : new Error(String(error)), restartCount);
      setImmediate(() => this.#execute(fn));
    });
  }

  #pruneOldRestarts() {
    const windowStart = Date.now() - this.#opts.restartWindowMs;
    this.#restartTimestamps = this.#restartTimestamps.filter(ts => ts > windowStart);
  }

  #startHealthCheck() {
    this.#clearHealthCheck();
    this.#healthCheckTimer = setInterval(() => {
      if (!this.#running || this.#stopped) this.#healthy = false;
    }, this.#opts.healthCheckIntervalMs);
    this.#healthCheckTimer.unref?.();
  }

  #clearHealthCheck() {
    if (this.#healthCheckTimer !== null) {
      clearInterval(this.#healthCheckTimer);
      this.#healthCheckTimer = null;
    }
  }
}
