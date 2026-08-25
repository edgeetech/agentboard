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

export interface BundledRunSchedulerPorts<TDatabase, TProject, TQueuedRun> {
  listProjectCodes(): readonly string[];
  openProject(code: string): Promise<TDatabase>;
  getProject(database: TDatabase): TProject | undefined;
  maxParallel(project: TProject): number;
  runningCount(database: TDatabase): number;
  listQueuedRuns(database: TDatabase): readonly TQueuedRun[];
  dispatchRun(database: TDatabase, project: TProject, run: TQueuedRun): Promise<void>;
  reapOrphans(database: TDatabase, timeoutMs: number): readonly unknown[];
  reportError(error: unknown, projectCode: string): void;
  reportReaped(projectCode: string, count: number): void;
}

export function drainQueuedRunsOnce<TDatabase, TProject, TQueuedRun>(
  ports: BundledRunSchedulerPorts<TDatabase, TProject, TQueuedRun>,
): Promise<void>;

export function reapProjectRunsOnce<TDatabase, TProject, TQueuedRun>(
  timeoutMs: number,
  ports: BundledRunSchedulerPorts<TDatabase, TProject, TQueuedRun>,
): Promise<void>;
