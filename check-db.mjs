import Database from 'better-sqlite3';
const dbPath = `${process.env.USERPROFILE}\.agentboard\projects\demo.db`;
const db = new Database(dbPath);
const project = db.prepare(`SELECT code, auto_dispatch_pm, max_parallel FROM project`).get();
const runs = db.prepare(`SELECT id, status, role, created_at FROM agent_run ORDER BY created_at DESC LIMIT 10`).all();
console.log('Project:', project);
console.log('Recent runs:');
runs.forEach(r => {
  const relTime = Math.round((Date.now() - new Date(r.created_at).getTime()) / 1000) + 's ago';
  console.log(`  ${r.id.substring(0, 8)} ${r.status.padEnd(10)} ${r.role} (${relTime})`);
});
