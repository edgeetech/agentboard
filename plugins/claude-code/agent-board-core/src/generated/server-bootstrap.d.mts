export interface BundledBackgroundWorkerContext {
  readonly port: number;
  readonly serverToken: string;
}

export interface BundledBackgroundWorkerPorts {
  startExecutor(context: BundledBackgroundWorkerContext): void;
  startSkillScanWorkers(): Promise<void>;
  stopSkillScanWorkers(): Promise<void>;
  reportError(error: unknown): void;
}

export interface BundledBackgroundWorkerHandle {
  shutdown(): Promise<void>;
}

export function startBackgroundWorkers(
  context: BundledBackgroundWorkerContext,
  ports: BundledBackgroundWorkerPorts,
): BundledBackgroundWorkerHandle;
