import { getDb } from './src/project-registry.ts';

interface AgentRunRow {
  id: string;
  task_id: string;
  status: string;
  created_at: string;
}

async function checkRuns(): Promise<void> {
  const db = await getDb('TEST');
  const runs = db
    .prepare(
      'SELECT id, task_id, status, created_at FROM agent_run ORDER BY created_at DESC LIMIT 15',
    )
    .all() as AgentRunRow[];
  console.warn('Recent agent_run records:');
  console.warn('ID | TASK | STATUS | CREATED');
  console.warn('---+------+--------+---');
  for (const r of runs) {
    console.warn(`${r.id.substring(0, 8)} | ${r.task_id} | ${r.status} | ${r.created_at}`);
  }
  process.exit(0);
}

checkRuns().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
