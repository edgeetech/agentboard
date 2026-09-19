import type { IncomingMessage, ServerResponse } from 'node:http';

export type RestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => unknown | Promise<unknown>;

export async function dispatchRestHandlers(
  handlers: RestHandler[],
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  for (const handler of handlers) {
    const done = await handler(req, res, url);
    if (done === true || responseAlreadySent(res)) return true;
  }
  return false;
}

function responseAlreadySent(res: ServerResponse): boolean {
  return res.headersSent;
}
