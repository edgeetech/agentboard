import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(homedir(), '.agentboard', 'projects', 'test.db');
const db = new Database(dbPath);

console.log('=== TASK TEST-30 ===');
const task = db.prepare('SELECT id, code, status, assignee_role FROM task WHERE code="TEST-30" LIMIT 1').get();
if (task) {
  console.log(JSON.stringify(task, null, 2));
  
  console.log('\n=== AGENT RUNS FOR TEST-30 ===');
  const runs = db.prepare('SELECT id, role, status, queued_at FROM agent_run WHERE task_id=? ORDER BY queued_at DESC').all(task.id);
  console.log(JSON.stringify(runs, null, 2));
} else {
  console.log('Task TEST-30 not found');
}

db.close();
