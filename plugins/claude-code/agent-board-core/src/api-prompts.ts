// Serve raw prompt markdown files for roles and skills.
// GET /api/prompts/:kind/:id  → { kind, id, path?, content? }
//
// Resolution order (first file that exists wins):
//   prompts/<kind>s/<id>.md   (e.g. prompts/roles/worker.md)
//   prompts/<kind>/<id>.md    (e.g. prompts/role/worker.md)
//   prompts/<id>.md           (legacy — current role prompts live here)
//
// Path traversal is prevented by whitelisting `id` to [a-zA-Z0-9_-]+.

import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { json } from './http-util.ts';

const PROMPTS_URL = new URL('../prompts/', import.meta.url);

const KIND_WHITELIST = new Set<string>(['role', 'skill']);
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function candidatePaths(kind: string, id: string): URL[] {
  return [
    new URL(`${kind}s/${id}.md`, PROMPTS_URL), // roles/worker.md
    new URL(`${kind}/${id}.md`, PROMPTS_URL), // role/worker.md
    new URL(`${id}.md`, PROMPTS_URL), // worker.md (legacy)
  ];
}

export function handlePrompts(req: IncomingMessage, res: ServerResponse, url: URL): true | null {
  if (req.method !== 'GET') return null;
  const m = /^\/api\/prompts\/([a-z]+)\/([^/]+)$/.exec(url.pathname);
  if (!m) return null;

  const kind = m[1] ?? '';
  const id = decodeURIComponent(m[2] ?? '');
  if (!KIND_WHITELIST.has(kind)) {
    json(res, 400, { error: 'unknown kind' });
    return true;
  }
  if (!ID_RE.test(id)) {
    json(res, 400, { error: 'invalid id' });
    return true;
  }

  for (const candidate of candidatePaths(kind, id)) {
    try {
      if (!existsSync(candidate)) continue;
      const content = readFileSync(candidate, 'utf8');
      json(res, 200, {
        kind,
        id,
        path: candidate.pathname.replace(/^.*\/prompts\//, 'prompts/'),
        content,
      });
      return true;
    } catch {
      /* try next candidate */
    }
  }
  json(res, 404, { kind, id, content: null, error: 'prompt not found' });
  return true;
}
