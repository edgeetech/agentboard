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
export { startBackgroundWorkers };
