import { randomBytes } from 'node:crypto';

// Minimal inline types for Express-compatible middleware (no @types/express).
interface IncomingHeaders {
  authorization?: string | undefined;
  host?: string | undefined;
  origin?: string | undefined;
  [key: string]: string | string[] | undefined;
}

interface Req {
  headers: IncomingHeaders;
  method: string;
}

interface Res {
  status(code: number): Res;
  json(body: Record<string, string>): void;
  setHeader(name: string, value: string): void;
  end(): void;
}

type Next = () => void;
type Middleware = (req: Req, res: Res, next: Next) => void;

export const MIN_CLAUDE_CLI = '2.0.0';

export function generateServerToken(): string {
  return randomBytes(32).toString('hex');
}

export function bearerAuth(serverToken: string): Middleware {
  return (req: Req, res: Res, next: Next): void => {
    const h = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (m?.[1] !== serverToken) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

// Blocks DNS rebinding / foreign-origin drive-by.
export function hostAndOriginGuard(port: number): Middleware {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  return (req: Req, res: Res, next: Next): void => {
    const host = req.headers.host ?? '';
    if (!allowedHosts.has(host)) {
      res.status(421).json({ error: `host ${host} not allowed` });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      res.status(421).json({ error: `origin ${origin} not allowed` });
      return;
    }
    next();
  };
}

export function corsHeaders(port: number): Middleware {
  return (req: Req, res: Res, next: Next): void => {
    const origin = req.headers.origin;
    if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Credentials', 'false');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
