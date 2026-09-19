export interface RunSchedulerPorts<TDatabase, TProject, TQueuedRun> {
  listProjectCodes(): readonly string[];
  openProject(code: string): Promise<TDatabase>;
  getProject(database: TDatabase): TProject | undefined;
  maxParallel(project: TProject): number;
  runningCount(database: TDatabase): number;
  listQueuedRuns(database: TDatabase): readonly TQueuedRun[];
  dispatchRun(
    database: TDatabase,
    project: TProject,
    run: TQueuedRun,
  ): Promise<void>;
  reapOrphans(database: TDatabase, timeoutMs: number): readonly unknown[];
  reportError(error: unknown, projectCode: string): void;
  reportReaped(projectCode: string, count: number): void;
}

export async function drainQueuedRunsOnce<TDatabase, TProject, TQueuedRun>(
  ports: RunSchedulerPorts<TDatabase, TProject, TQueuedRun>,
): Promise<void> {
  for (const code of ports.listProjectCodes()) {
    try {
      const database = await ports.openProject(code);
      const project = ports.getProject(database);
      if (project === undefined) continue;

      const budget = ports.maxParallel(project) - ports.runningCount(database);
      if (budget <= 0) continue;
      for (const run of ports.listQueuedRuns(database).slice(0, budget)) {
        void ports
          .dispatchRun(database, project, run)
          .catch((error: unknown) => {
            ports.reportError(error, code);
          });
      }
    } catch (error) {
      ports.reportError(error, code);
    }
  }
}

export async function reapProjectRunsOnce<TDatabase, TProject, TQueuedRun>(
  timeoutMs: number,
  ports: RunSchedulerPorts<TDatabase, TProject, TQueuedRun>,
): Promise<void> {
  for (const code of ports.listProjectCodes()) {
    try {
      const database = await ports.openProject(code);
      const orphaned = ports.reapOrphans(database, timeoutMs);
      if (orphaned.length > 0) ports.reportReaped(code, orphaned.length);
    } catch (error) {
      ports.reportError(error, code);
    }
  }
}
