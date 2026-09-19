export interface BackgroundWorkerContext {
  readonly port: number;
  readonly serverToken: string;
}

export interface BackgroundWorkerPorts {
  startExecutor(context: BackgroundWorkerContext): void;
  startSkillScanWorkers(): Promise<void>;
  stopSkillScanWorkers(): Promise<void>;
  reportError(error: unknown): void;
}

export interface BackgroundWorkerHandle {
  shutdown(): Promise<void>;
}

export function startBackgroundWorkers(
  context: BackgroundWorkerContext,
  ports: BackgroundWorkerPorts,
): BackgroundWorkerHandle {
  ports.startExecutor(context);
  void ports.startSkillScanWorkers().catch(ports.reportError);

  let shutdownPromise: Promise<void> | null = null;
  return {
    shutdown() {
      shutdownPromise ??= ports
        .stopSkillScanWorkers()
        .catch((error: unknown) => {
          ports.reportError(error);
        });
      return shutdownPromise;
    },
  };
}
