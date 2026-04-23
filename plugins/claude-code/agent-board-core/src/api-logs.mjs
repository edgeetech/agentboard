import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { matchRoute, json } from './http-util.mjs';
import { logsDir } from './paths.mjs';
import { isUlid } from './ulid.mjs';

export async function handleLogs(req, res, url) {
  const mm = matchRoute('/api/logs/:run_id', url.pathname);
  if (!mm || req.method !== 'GET') return null;
  const runId = mm.run_id;
  if (!isUlid(runId)) return json(res, 400, { error: 'invalid run_id' });
  const dir = logsDir();
  const abs = resolve(dir, `${runId}.jsonl`);
  if (!abs.startsWith(dir + sep) && abs !== `${dir}${sep}${runId}.jsonl`) {
    return json(res, 400, { error: 'path traversal' });
  }
  let st;
  try { st = statSync(abs); } catch { return json(res, 404, { error: 'no log' }); }
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Content-Length': st.size,
  });
  createReadStream(abs).pipe(res);
  return 'streamed';
}
