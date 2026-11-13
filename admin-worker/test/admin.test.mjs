import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { handle } from '../src/index.js';
import { COOKIE, LIMIT, makeSecret, parseSecret, signSession, verifyKey, verifySession } from '../src/lib/auth.js';
import { isLikelyAutomated, readVisits } from '../src/lib/visits.js';

const ORIGIN = 'https://chilaka-admin.example.workers.dev';
const SALT = 'ab'.repeat(16);
const keyOf = (pw) => pbkdf2Sync(pw, 'chilaka-admin-v1', 1000, 32, 'sha256').toString('hex'); // few rounds: tests only
const GOOD = keyOf('correct horse battery');

function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, { value: v.value ?? v, metadata: v.metadata }]));
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k).value : null; },
    async put(k, value, opts = {}) { m.set(k, { value, metadata: opts.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name, metadata: m.get(name).metadata }));
      return { keys, list_complete: true };
    },
  };
}
const fakeDb = (emails) => ({
  queries: [],
  prepare(sql) { this.queries.push(sql); return { all: async () => ({ results: emails.map((email) => ({ email })) }) }; },
});
async function envWith(extra = {}) {
  return { ADMIN_PASSWORD_HASH: await makeSecret(GOOD, SALT), VISITS: fakeKv(), DB: fakeDb(['b@example.com', 'a@example.com']), ...extra };
}
const req = (path, { method = 'GET', body, cookie, origin = ORIGIN, ip = '203.0.113.9' } = {}) =>
  new Request(ORIGIN + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(method === 'POST' && origin ? { origin } : {}), 'cf-connecting-ip': ip },
    body: body ? JSON.stringify(body) : undefined,
  });
async function login(env, authKey = GOOD, opts = {}) {
  const res = await handle(req('/api/login', { method: 'POST', body: { authKey }, ...opts }), env);
  const set = res.headers.get('set-cookie') || '';
  return { res, cookie: set.split(';')[0] };
}

test('password secret: only the right derived key verifies', async () => {
  const secret = await makeSecret(GOOD, SALT);
  assert.ok(parseSecret(secret));
  assert.equal(await verifyKey(secret, GOOD), true);
  assert.equal(await verifyKey(secret, keyOf('correct horse batterx')), false);
  assert.equal(await verifyKey(secret, ''), false);
  assert.equal(await verifyKey(secret, 'zz'.repeat(32)), false);
  assert.equal(await verifyKey('', GOOD), false);
  assert.equal(await verifyKey('v1$short$nope', GOOD), false);
  assert.ok(!secret.includes(GOOD)); // the key itself is not stored
});

test('sessions: valid until expiry, tamper-proof, tied to the password', async () => {
  const secret = await makeSecret(GOOD, SALT);
  const t = await signSession(secret, 1000, 60);
  assert.equal(await verifySession(secret, t, 1030), true);
  assert.equal(await verifySession(secret, t, 1060), false); // expired
  const [exp, sig] = t.split('.');
  assert.equal(await verifySession(secret, `${Number(exp) + 9999}.${sig}`, 1030), false); // extended by hand
  assert.equal(await verifySession(secret, `${exp}.${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`, 1030), false);
  assert.equal(await verifySession(await makeSecret(keyOf('another password'), SALT), t, 1030), false); // password changed
  assert.equal(await verifySession(secret, '', 1030), false);
});

test('nothing is readable without a session', async () => {
  const env = await envWith();
  for (const path of ['/api/me', '/api/emails', '/api/visits', '/api/github']) {
    const res = await handle(req(path), env);
    assert.equal(res.status, 401, path);
    assert.deepEqual(await res.json(), { error: 'auth' });
  }
  assert.equal((await handle(req('/api/emails', { cookie: `${COOKIE}=9999999999.${'0'.repeat(64)}` }), env)).status, 401);
  assert.equal(env.DB.queries.length, 0); // the database was never touched
});

test('with no password set, everything is closed (also sign-in)', async () => {
  for (const secret of [undefined, '', 'password123', 'v1$zz$zz']) {
    const env = await envWith({ ADMIN_PASSWORD_HASH: secret });
    assert.equal((await handle(req('/api/emails'), env)).status, 503);
    assert.equal((await login(env)).res.status, 503);
  }
});

test('sign in, read emails only, sign out', async () => {
  const env = await envWith();
  const { res, cookie } = await login(env);
  assert.equal(res.status, 200);
  const set = res.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(set.includes(flag), flag);
  assert.ok(cookie.startsWith(`${COOKIE}=`));

  const emails = await handle(req('/api/emails', { cookie }), env);
  assert.equal(emails.status, 200);
  assert.equal(emails.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await emails.json(), { count: 2, emails: ['b@example.com', 'a@example.com'] });
  assert.match(env.DB.queries[0], /^SELECT email FROM users/); // no other column is ever selected

  const out = await handle(req('/api/logout', { method: 'POST', cookie }), env);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('wrong passwords are refused and limited per address', async () => {
  const env = await envWith();
  for (let i = 0; i < LIMIT.perIp; i++) assert.equal((await login(env, keyOf(`guess ${i}`))).res.status, 401);
  assert.equal((await login(env, keyOf('one more'))).res.status, 429);
  assert.equal((await login(env)).res.status, 429); // even the right password waits out the window
  assert.equal((await login(env, GOOD, { ip: '198.51.100.7' })).res.status, 200); // someone else is not locked out
  // a successful sign-in clears that address's count
  const env2 = await envWith();
  await login(env2, keyOf('typo'));
  assert.equal((await login(env2)).res.status, 200);
  assert.equal(env2.VISITS.m.has([...env2.VISITS.m.keys()].find((k) => k.startsWith('admin:rl:') && k !== 'admin:rl:all') ?? '-'), false);
});

test('sign-in from another site is refused; malformed bodies are just wrong', async () => {
  const env = await envWith();
  assert.equal((await login(env, GOOD, { origin: 'https://evil.example' })).res.status, 403);
  assert.equal((await login(env, GOOD, { origin: '' })).res.status, 403);
  const bad = new Request(`${ORIGIN}/api/login`, { method: 'POST', headers: { origin: ORIGIN }, body: 'not json' });
  assert.equal((await handle(bad, env)).status, 401);
  assert.equal((await handle(req('/api/emails', { method: 'DELETE' }), env)).status, 405);
  assert.equal((await handle(req('/secrets'), env)).status, 404);
});

const visit = (ts, id, extra = {}) => ({ ts, site: 'website', page: '/', city: 'Seattle', region: 'Washington', country: 'US', device: 'phone', browser: 'safari', referrer: '', network: 'Comcast Cable', visitor: id, ...extra });

test('automated visits are told apart from people', () => {
  assert.equal(isLikelyAutomated(visit('t', 'a')), false);
  assert.equal(isLikelyAutomated(visit('t', 'a', { network: 'T-Mobile USA' })), false);
  assert.equal(isLikelyAutomated(visit('t', 'a', { network: '' })), false); // older entries with no network recorded
  assert.equal(isLikelyAutomated(visit('t', 'a', { network: 'Amazon.com, Inc.' })), true);
  assert.equal(isLikelyAutomated(visit('t', 'a', { network: 'DigitalOcean, LLC' })), true);
  assert.equal(isLikelyAutomated(visit('t', 'a', { device: 'other', browser: 'other', network: '' })), true);
});

test('visit log: newest first, older pages, live updates, values from metadata or the entry', async () => {
  const now = Date.parse('2026-11-12T12:00:00.000Z');
  const seed = {};
  for (let i = 0; i < 55; i++) {
    const ts = new Date(now - (i + 1) * 3600_000).toISOString();
    const v = visit(ts, (1000 + i).toString(16), i % 5 === 0 ? { network: 'Amazon.com, Inc.' } : {});
    // half written the new way (entry in metadata), half the old way (value only)
    seed[`v:${ts}:${v.visitor}`] = i % 2 ? { value: JSON.stringify(v), metadata: v } : { value: JSON.stringify(v) };
  }
  seed['admin:gh'] = { value: '{}' }; // other keys in the namespace are ignored
  const kv = fakeKv(seed);

  const first = await readVisits(kv, { now });
  assert.equal(first.visits.length, 40);
  assert.equal(first.total, 55);
  assert.equal(first.more, true);
  assert.ok(first.visits[0].ts > first.visits[1].ts);
  assert.equal(first.visits[0].automated, true);
  assert.equal(first.visits[1].automated, false);
  assert.equal(Object.values(first.perDay).reduce((a, b) => a + b, 0), 55);

  const older = await readVisits(kv, { before: first.visits.at(-1).key, now });
  assert.equal(older.visits.length, 15);
  assert.equal(older.more, false);
  assert.ok(older.visits[0].key < first.visits.at(-1).key);

  // nothing new yet
  assert.deepEqual((await readVisits(kv, { after: first.visits[0].key, now })).visits, []);
  // two arrive, one of them after midnight UTC
  const a = visit('2026-11-12T12:05:00.000Z', 'aaa1');
  const b = visit('2026-11-13T00:10:00.000Z', 'aaa2', { site: 'app', page: '/app', mode: 'installed' });
  await kv.put(`v:${a.ts}:${a.visitor}`, JSON.stringify(a), { metadata: a });
  await kv.put(`v:${b.ts}:${b.visitor}`, JSON.stringify(b));
  const live = await readVisits(kv, { after: first.visits[0].key, now: Date.parse('2026-11-13T00:11:00.000Z') });
  assert.deepEqual(live.visits.map((v) => v.visitor), ['aaa2', 'aaa1']);
  assert.equal(live.visits[0].site, 'app');
  // a made-up cursor cannot be used to read other keys
  assert.equal((await readVisits(kv, { after: 'admin:', now })).visits.length, 40);
});

test('visits API needs the session and passes the cursors through', async () => {
  const env = await envWith();
  const v = visit('2026-11-12T10:00:00.000Z', 'beef');
  await env.VISITS.put(`v:${v.ts}:${v.visitor}`, JSON.stringify(v));
  const { cookie } = await login(env);
  const res = await handle(req('/api/visits', { cookie }), env, Date.parse('2026-11-12T12:00:00.000Z'));
  const body = await res.json();
  assert.equal(body.visits.length, 1);
  assert.equal(body.visits[0].city, 'Seattle');
  assert.equal(body.visits[0].ip, undefined); // no address is stored or returned
});

test('developer version: files are served only to the signed-in owner', async () => {
  const served = [];
  const env = await envWith({
    ASSETS: {
      async fetch(request) {
        served.push(new URL(request.url).pathname);
        return new Response('<html>dev app</html>', { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=3600' } });
      },
    },
  });
  const page = (path, cookie, accept = 'text/html') => new Request(ORIGIN + path, { headers: { accept, ...(cookie ? { cookie } : {}) } });

  // a stranger opening the page is sent to sign in; a stranger fetching a file gets nothing
  const anon = await handle(page('/dev/'), env);
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/?next=dev');
  for (const path of ['/dev/assets/index.js', '/dev/build.json', '/dev/audio/v-female/u01-i01.m4a', '/dev']) {
    assert.equal((await handle(page(path, '', '*/*'), env)).status, 401, path);
  }
  assert.equal((await handle(page('/dev/', `${COOKIE}=9999999999.${'0'.repeat(64)}`), env)).status, 302);
  assert.deepEqual(served, []); // not one byte of the app left the worker

  const { cookie } = await login(env);
  const ok = await handle(page('/dev/', cookie), env);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '<html>dev app</html>');
  assert.equal(ok.headers.get('cache-control'), 'private, no-cache'); // never left in a shared cache
  assert.match(ok.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await handle(page('/dev/assets/index.js', cookie, '*/*'), env)).status, 200);
  assert.deepEqual(served, ['/dev/', '/dev/assets/index.js']);

  // read-only, and nothing outside /dev is reachable this way
  assert.equal((await handle(new Request(`${ORIGIN}/dev/`, { method: 'POST', headers: { cookie, origin: ORIGIN } }), env)).status, 405);
  assert.equal((await handle(page('/development/secret', cookie), env)).status, 404);
  // with no password set, the developer version is closed too
  const closed = await envWith({ ADMIN_PASSWORD_HASH: '', ASSETS: env.ASSETS });
  assert.equal((await handle(page('/dev/', cookie), closed)).status, 302);
});

test('sign-in still works when the attempt counters cannot be written (KV quota used up)', async () => {
  const env = await envWith();
  env.VISITS.put = async () => { throw new Error('KV put() limit exceeded for the day'); };
  env.VISITS.delete = async () => { throw new Error('KV delete() limit exceeded for the day'); };
  assert.equal((await login(env, keyOf('wrong one'))).res.status, 401);
  const ok = await login(env);
  assert.equal(ok.res.status, 200);
  assert.ok(ok.cookie.startsWith(`${COOKIE}=`));
});

test('laptop-only lock: without the device key nothing exists, with it everything works as before', async () => {
  const { createHash } = await import('node:crypto');
  const KEY = 'c3'.repeat(32);
  const hash = createHash('sha256').update(`device|${KEY}`).digest('hex');
  const env = await envWith({ ADMIN_DEVICE_HASH: hash, ASSETS: { fetch: async () => new Response('page') } });
  const withKey = (path, opts = {}, key = KEY) => {
    const r = req(path, opts);
    const headers = new Headers(r.headers);
    if (key !== null) headers.set('x-chilaka-device', key);
    return new Request(r, { headers });
  };
  // no key, wrong key, the hash itself: 404 on the page, the API, sign-in and the developer version
  for (const key of [null, 'd4'.repeat(32), hash, '']) {
    for (const path of ['/', '/app.js', '/api/me', '/api/emails', '/dev/', '/dev/index.html']) {
      const res = await handle(withKey(path, {}, key), env);
      assert.equal(res.status, 404, `${path} with ${key}`);
      assert.equal(await res.text(), 'Not found');
    }
    assert.equal((await handle(withKey('/api/login', { method: 'POST', body: { authKey: GOOD } }, key), env)).status, 404);
  }
  // right key: the page loads, the password is still required, and sign-in works
  assert.equal(await (await handle(withKey('/'), env)).text(), 'page');
  assert.equal((await handle(withKey('/api/emails'), env)).status, 401);
  const li = await handle(withKey('/api/login', { method: 'POST', body: { authKey: GOOD } }), env);
  assert.equal(li.status, 200);
  const cookie = li.headers.get('set-cookie').split(';')[0];
  assert.equal((await handle(withKey('/api/emails', { cookie }), env)).status, 200);
  // a stolen session cookie alone is useless off this laptop
  assert.equal((await handle(req('/api/emails', { cookie }), env)).status, 404);
  // lock not set (or malformed): behaves exactly as before
  const open = await envWith({ ADMIN_DEVICE_HASH: 'nope' });
  assert.equal((await handle(req('/api/me'), open)).status, 401);
});
