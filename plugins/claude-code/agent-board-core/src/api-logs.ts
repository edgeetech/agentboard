import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';

import { matchRoute, json } from './http-util.ts';
import { logsDir } from './paths.ts';
import { isUlid } from './ulid.ts';

export function handleLogs(req: IncomingMessage, res: ServerResponse, url: URL): string | null {
  const mm = matchRoute('/api/logs/:run_id', url.pathname);
  if (!mm || req.method !== 'GET') return null;
  const runId = mm.run_id ?? '';
  if (!isUlid(runId)) {
    json(res, 400, { error: 'invalid run_id' });
    return 'handled';
  }
  const dir = logsDir();
  const abs = resolve(dir, `${runId}.jsonl`);
  if (!abs.startsWith(dir + sep) && abs !== `${dir}${sep}${runId}.jsonl`) {
    json(res, 400, { error: 'path traversal' });
    return 'handled';
  }
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(abs);
  } catch {
    json(res, 404, { error: 'no log' });
    return 'handled';
  }
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Content-Length': st.size,
  });
  createReadStream(abs).pipe(res);
  return 'streamed';
}
