import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(homedir(), '.agentboard', 'projects', 'test.db');
const db = new Database(dbPath);

console.log('=== TASK TEST-27 ===');
const task = db.prepare('SELECT id, code, status, assignee_role, has_active_run FROM task WHERE code="TEST-27" LIMIT 1').get();
console.log(JSON.stringify(task, null, 2));

console.log('\n=== AGENT RUNS FOR TEST-27 ===');
if (task) {
  const runs = db.prepare('SELECT id, role, status, queued_at, started_at FROM agent_run WHERE task_id=? ORDER BY queued_at DESC').all(task.id);
  console.log(JSON.stringify(runs, null, 2));
}

db.close();
