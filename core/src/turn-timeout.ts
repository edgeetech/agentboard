export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Turn timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class TurnTimeout {
  readonly #controller: AbortController;
  readonly #timeoutMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(timeoutMs: number, parentSignal?: AbortSignal) {
    this.#timeoutMs = timeoutMs;
    this.#controller = new AbortController();
    if (parentSignal) {
      if (parentSignal.aborted) {
        this.#controller.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener(
          'abort',
          () => {
            this.#controller.abort(parentSignal.reason);
            this.#clearTimer();
          },
          { once: true },
        );
      }
    }
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  start(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#controller.abort(new TimeoutError(this.#timeoutMs));
    }, this.#timeoutMs);
  }

  clear(): void {
    this.#clearTimer();
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  static async withTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    const tt = new TurnTimeout(timeoutMs, parentSignal);
    tt.start();
    try {
      return await Promise.race([
        fn(tt.signal),
        new Promise<never>((_resolve, reject) => {
          const rejectWithReason = (): void => {
            const r: unknown = tt.signal.reason;
            reject(r instanceof Error ? r : new Error(String(r)));
          };
          if (tt.signal.aborted) {
            rejectWithReason();
            return;
          }
          tt.signal.addEventListener('abort', rejectWithReason, { once: true });
        }),
      ]);
    } finally {
      tt.clear();
    }
  }
}
