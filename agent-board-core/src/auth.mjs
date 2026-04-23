import { randomBytes } from 'node:crypto';

const MIN_CLAUDE_CLI = '2.0.0';

export function generateServerToken() {
  return randomBytes(32).toString('hex');
}

export function bearerAuth(serverToken) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (!m || m[1] !== serverToken) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}

// Blocks DNS rebinding / foreign-origin drive-by.
export function hostAndOriginGuard(port) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  return (req, res, next) => {
    const host = req.headers.host || '';
    if (!allowedHosts.has(host)) {
      return res.status(421).json({ error: `host ${host} not allowed` });
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(421).json({ error: `origin ${origin} not allowed` });
    }
    next();
  };
}

export function corsHeaders(port) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Credentials', 'false');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

export { MIN_CLAUDE_CLI };
