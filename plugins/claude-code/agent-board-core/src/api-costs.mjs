import { json, matchRoute } from './http-util.mjs';

export async function handleCosts(req, res, url) {
  let mm;

  if ((mm = matchRoute('/api/projects/:code/costs', url.pathname)) && req.method === 'GET') {
    return json(res, 200, { rows: [] });
  }

  if ((mm = matchRoute('/api/projects/:code/costs/total', url.pathname)) && req.method === 'GET') {
    return json(res, 200, { all_time: 0, last_7d: 0, last_30d: 0, uncosted_runs: 0 });
  }

  return null;
}
