// server/src/bootstrap/start-background-workers.ts
function startBackgroundWorkers(context, ports) {
  ports.startExecutor(context);
  void ports.startSkillScanWorkers().catch(ports.reportError);
  let shutdownPromise = null;
  return {
    shutdown() {
      shutdownPromise ??= ports.stopSkillScanWorkers().catch((error) => {
        ports.reportError(error);
      });
      return shutdownPromise;
    },
  };
}

// server/src/workers/run-scheduler.ts
async function drainQueuedRunsOnce(ports) {
  for (const code of ports.listProjectCodes()) {
    try {
      const database = await ports.openProject(code);
      const project = ports.getProject(database);
      if (project === void 0) continue;
      const budget = ports.maxParallel(project) - ports.runningCount(database);
      if (budget <= 0) continue;
      for (const run of ports.listQueuedRuns(database).slice(0, budget)) {
        void ports.dispatchRun(database, project, run).catch((error) => {
          ports.reportError(error, code);
        });
      }
    } catch (error) {
      ports.reportError(error, code);
    }
  }
}
async function reapProjectRunsOnce(timeoutMs, ports) {
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
export { drainQueuedRunsOnce, reapProjectRunsOnce, startBackgroundWorkers };
