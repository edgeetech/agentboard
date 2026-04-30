import { getDb } from './src/repo.mjs';

async function checkRuns() {
  const db = await getDb('TEST');
  const runs = db.prepare('SELECT id, task_id, status, created_at FROM agent_run ORDER BY created_at DESC LIMIT 15').all();
  console.log('Recent agent_run records:');
  console.log('ID | TASK | STATUS | CREATED');
  console.log('---+------+--------+---');
  runs.forEach(r => {
    console.log(`${r.id.substring(0, 8)} | ${r.task_id} | ${r.status} | ${r.created_at}`);
  });
  process.exit(0);
}

checkRuns().catch(e => { console.error(e); process.exit(1); });
