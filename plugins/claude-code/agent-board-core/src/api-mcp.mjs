// HTTP MCP endpoint — disabled in simplified mode (no agent spawn).
import { json } from './http-util.mjs';

export async function handleMcp(req, res, url) {
  if (url.pathname !== '/mcp' || req.method !== 'POST') return null;
  return json(res, 410, { error: 'MCP endpoint disabled in simplified mode (no agent spawn)' });
}
