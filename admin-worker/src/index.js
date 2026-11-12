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

/** The developer version of the app: the same files as a release, behind the owner's session. */
async function serveDev(request, env, url, nowSec) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method' });
  const secret = env.ADMIN_PASSWORD_HASH;
  if (!(await verifySession(secret, readCookie(request), nowSec))) {
    // a page load goes to the sign-in page and comes back; anything else is just refused
    const wantsPage = (request.headers.get('accept') || '').includes('text/html');
    if (wantsPage) return new Response(null, { status: 302, headers: { location: '/?next=dev', 'cache-control': 'no-store' } });
    return json(401, { error: 'auth' });
  }
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('cache-control', 'private, no-cache'); // never kept by a shared cache; always revalidated
  headers.set('referrer-policy', 'no-referrer');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (url.pathname === '/dev' || url.pathname.startsWith('/dev/')) return serveDev(request, env, url, Math.floor(now / 1000));
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
      // the attempt counters live in KV: if its daily quota is used up, reads or writes can
      // throw, and that must not turn a correct password into an error page
      const quiet = async (fn, fallback) => {
        try {
          return await fn();
        } catch (e) {
          console.error('attempt counter unavailable', e);
          return fallback;
        }
      };
      if (await quiet(() => tooManyAttempts(env.VISITS, ipKey), false)) return json(429, { error: 'rate' });
      let body = {};
      try {
        body = await request.json();
      } catch {
        /* treated as a wrong password */
      }
      if (!(await verifyKey(secret, body.authKey))) {
        await quiet(() => recordFailure(env.VISITS, ipKey));
        return json(401, { error: 'invalid' });
      }
      await quiet(() => clearFailures(env.VISITS, ipKey));
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
