import type { IncomingMessage, ServerResponse } from 'node:http';

import { runDoctor } from './doctor.ts';
import { json, matchRoute } from './http-util.ts';
import { validateCode } from './project-code.ts';
import { getActiveDb, getDb } from './project-registry.ts';

export async function handleDoctor(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<null | true> {
  if (req.method !== 'GET') return null;

  if (url.pathname === '/api/doctor') {
    const active = await getActiveDb();
    json(res, 200, await runDoctor({ db: active?.db ?? null, projectCode: active?.code ?? null }));
    return true;
  }

  const match = matchRoute('/api/projects/:code/doctor', url.pathname);
  if (match === null) return null;
  const code = (match.code ?? '').trim().toUpperCase();
  const codeErr = validateCode(code);
  if (codeErr !== null) {
    json(res, 400, { error: codeErr });
    return true;
  }
  try {
    const db = await getDb(code);
    json(res, 200, await runDoctor({ db, projectCode: code }));
    return true;
  } catch {
    json(res, 404, { error: 'project not found' });
    return true;
  }
}
