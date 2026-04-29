// Ported from hatice src/turn-timeout.ts

export class TimeoutError extends Error {
  /** @param {number} ms */
  constructor(ms) {
    super(`Turn timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class TurnTimeout {
  #controller;
  #timeoutMs;
  #timer = null;

  /**
   * @param {number} timeoutMs
   * @param {AbortSignal} [parentSignal]
   */
  constructor(timeoutMs, parentSignal) {
    this.#timeoutMs = timeoutMs;
    this.#controller = new AbortController();
    if (parentSignal) {
      if (parentSignal.aborted) {
        this.#controller.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener('abort', () => {
          this.#controller.abort(parentSignal.reason);
          this.#clearTimer();
        }, { once: true });
      }
    }
  }

  get signal() { return this.#controller.signal; }

  start() {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#controller.abort(new TimeoutError(this.#timeoutMs));
    }, this.#timeoutMs);
  }

  clear() { this.#clearTimer(); }

  #clearTimer() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * @template T
   * @param {(signal: AbortSignal) => Promise<T>} fn
   * @param {number} timeoutMs
   * @param {AbortSignal} [parentSignal]
   * @returns {Promise<T>}
   */
  static async withTimeout(fn, timeoutMs, parentSignal) {
    const tt = new TurnTimeout(timeoutMs, parentSignal);
    tt.start();
    try {
      return await Promise.race([
        fn(tt.signal),
        new Promise((_resolve, reject) => {
          if (tt.signal.aborted) { reject(tt.signal.reason); return; }
          tt.signal.addEventListener('abort', () => reject(tt.signal.reason), { once: true });
        }),
      ]);
    } finally {
      tt.clear();
    }
  }
}
