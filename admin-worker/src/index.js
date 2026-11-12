// Chilaka owner dashboard API. Nothing here answers without a valid session,
// except sign-in itself; the page shell in public/ holds no data.

import {
  clearFailures,
  ipKeyOf,
  parseSecret,
  readCookie,
  recordFailure,
  sessionCookie,
  signSession,
  tooManyAttempts,
  verifyKey,
  verifySession,
} from './lib/auth.js';
import { readVisits } from './lib/visits.js';
import { readGithub } from './lib/github.js';

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex', ...headers },
  });

export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return json(404, { error: 'not-found' });
  const secret = env.ADMIN_PASSWORD_HASH;
  // no password set yet: nothing is readable by anyone
  if (!parseSecret(secret)) return json(503, { error: 'setup' });
  const nowSec = Math.floor(now / 1000);

  if (request.method === 'POST') {
    // same-origin only (the cookie is SameSite=Strict as well)
    if (request.headers.get('origin') !== url.origin) return json(403, { error: 'origin' });
    if (url.pathname === '/api/login') {
      const ipKey = await ipKeyOf(request);
      if (await tooManyAttempts(env.VISITS, ipKey)) return json(429, { error: 'rate' });
      let body = {};
      try {
        body = await request.json();
      } catch {
        /* treated as a wrong password */
      }
      if (!(await verifyKey(secret, body.authKey))) {
        await recordFailure(env.VISITS, ipKey);
        return json(401, { error: 'invalid' });
      }
      await clearFailures(env.VISITS, ipKey);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(await signSession(secret, nowSec)) });
    }
    if (url.pathname === '/api/logout') return json(200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
    return json(404, { error: 'not-found' });
  }
  if (request.method !== 'GET') return json(405, { error: 'method' });

  if (!(await verifySession(secret, readCookie(request), nowSec))) return json(401, { error: 'auth' });

  switch (url.pathname) {
    case '/api/me':
      return json(200, { ok: true });
    case '/api/emails': {
      // emails only: no ids, hashes, progress or anything else leaves the database
      const rows = await env.DB.prepare('SELECT email FROM users ORDER BY created_at DESC').all();
      const emails = (rows.results || []).map((r) => r.email);
      return json(200, { count: emails.length, emails });
    }
    case '/api/visits':
      return json(200, await readVisits(env.VISITS, { after: url.searchParams.get('after') || '', before: url.searchParams.get('before') || '', now }));
    case '/api/github':
      return json(200, await readGithub(env, { fresh: url.searchParams.get('fresh') === '1' }));
    default:
      return json(404, { error: 'not-found' });
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error('admin error', e);
      return json(500, { error: 'server' });
    }
  },
};
