export interface RunWorkerConfig {
  readonly drainIntervalMs: number;
  readonly reaperIntervalMs: number;
}

export interface RunWorkerTimer {
  unref?(): void;
}

export interface RunWorkerPorts {
  startSupervised(work: () => Promise<void>): void;
  drain(): Promise<void>;
  reap(): Promise<void>;
  delay(ms: number): Promise<void>;
  scheduleInterval(work: () => void, intervalMs: number): RunWorkerTimer;
  reportError(error: unknown): void;
}

export function startRunWorker(
  config: RunWorkerConfig,
  ports: RunWorkerPorts,
): void {
  ports.startSupervised(async () => {
    for (;;) {
      await ports.drain().catch(ports.reportError);
      await ports.delay(config.drainIntervalMs);
    }
  });

  const reaperTimer = ports.scheduleInterval(() => {
    void ports.reap().catch(ports.reportError);
  }, config.reaperIntervalMs);
  reaperTimer.unref?.();
}
