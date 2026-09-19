import type { IncomingMessage, ServerResponse } from 'node:http';

import { AUDIT_EXPORT_MAX_BYTES, buildTaskAudit, renderTaskAuditMarkdown } from './audit-export.ts';
import { json, matchRoute, text } from './http-util.ts';
import { validateCode } from './project-code.ts';
import { getDb } from './project-registry.ts';

export async function handleAudit(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<null | true> {
  const match = matchRoute('/api/projects/:code/tasks/:taskCode/audit', url.pathname);
  if (match === null) return null;
  if (req.method !== 'GET') return null;

  const code = (match.code ?? '').trim().toUpperCase();
  const codeErr = validateCode(code);
  if (codeErr !== null) {
    json(res, 400, { error: codeErr });
    return true;
  }

  const format = url.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'md' && format !== 'markdown') {
    json(res, 400, { error: 'format must be json or md' });
    return true;
  }

  try {
    const db = await getDb(code);
    const audit = buildTaskAudit(db, match.taskCode ?? '');
    const body =
      format === 'json' ? JSON.stringify(audit, null, 2) : renderTaskAuditMarkdown(audit);
    if (Buffer.byteLength(body) > AUDIT_EXPORT_MAX_BYTES) {
      json(res, 413, {
        error: 'audit export too large',
        max_bytes: AUDIT_EXPORT_MAX_BYTES,
        action: 'Export a smaller task or reduce activity volume before retrying.',
      });
      return true;
    }
    if (format === 'json') {
      text(res, 200, body, 'application/json; charset=utf-8');
    } else {
      text(res, 200, body, 'text/markdown; charset=utf-8');
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    json(res, msg.includes('not found') ? 404 : 500, { error: msg });
    return true;
  }
}
