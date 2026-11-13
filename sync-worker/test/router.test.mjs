import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { runReminders } from '../src/index.js';
import { _resetSecretCache } from '../src/lib/auth.js';
import { _resetVapidCache } from '../src/lib/push.js';
import { fakeEnv, req, authKey } from './helpers.mjs';

const call = (env, ...a) => worker.fetch(req(...a), env);
const body = async (res) => ({ status: res.status, json: await res.json() });
const SLOT = 'c'.repeat(56);
const backup = (lastActiveDay, current = 3) => ({
  app: 'chilaka',
  schemaVersion: 1,
  data: { streaks: [{ id: 'main', current, longest: 9, lastActiveDay }], profile: {} },
});

test.beforeEach(() => {
  _resetSecretCache();
  _resetVapidCache();
});

test('CORS preflight advertises authorization + DELETE', async () => {
  const res = await call(fakeEnv(), '/auth/me', { method: 'OPTIONS' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(res.headers.get('access-control-allow-methods'), /DELETE/);
});

test('legacy GET/PUT round trip stays on KV when no account owns the slot', async () => {
  const env = fakeEnv();
  assert.equal((await call(env, `/${SLOT}`)).status, 404);
  assert.equal((await call(env, '/nothex')).status, 400);

  let r = await body(await call(env, `/${SLOT}`, { method: 'PUT', body: { rev: 1, data: backup('2026-03-10') } }));
  assert.deepEqual(r, { status: 200, json: { rev: 1 } });
  r = await body(await call(env, `/${SLOT}`, { method: 'PUT', body: { rev: 1, data: backup('2026-03-10') } }));
  assert.deepEqual(r, { status: 409, json: { conflict: true, rev: 1 } });
  r = await body(await call(env, `/${SLOT}`, { method: 'PUT', body: { rev: 2, data: backup('2026-03-11') } }));
  assert.equal(r.status, 200);

  r = await body(await call(env, `/${SLOT}`));
  assert.equal(r.status, 200);
  assert.equal(r.json.rev, 2);
  assert.equal(typeof r.json.updatedAt, 'number');
  assert.equal(r.json.data.data.streaks[0].lastActiveDay, '2026-03-11');
  assert.ok(env.SYNC._map.has(`sync:${SLOT}`));
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM progress').first('n'), 0);

  assert.equal((await call(env, `/${SLOT}`, { method: 'PUT', body: 'nope' })).status, 400);
  assert.equal((await call(env, `/${SLOT}`, { method: 'PUT', body: { rev: 'x' } })).status, 400);
  assert.equal((await call(env, `/${SLOT}`, { method: 'POST' })).status, 405);
});

test('legacy routes work without a D1 binding at all', async () => {
  const env = fakeEnv({ d1: false });
  assert.equal((await call(env, `/${SLOT}`, { method: 'PUT', body: { rev: 1, data: backup('2026-03-10') } })).status, 200);
  assert.equal((await body(await call(env, `/${SLOT}`))).json.rev, 1);
  assert.equal((await call(env, '/auth/login', { method: 'POST', body: {} })).status, 503);
  assert.equal((await call(env, '/push/vapid')).status, 200);
});

test('/asr/<key> requires a known slot (KV or D1)', async () => {
  const env = fakeEnv();
  const wav = new Uint8Array(100);
  assert.equal((await call(env, `/asr/${SLOT}`, { method: 'POST', body: wav })).status, 403);
  await call(env, `/${SLOT}`, { method: 'PUT', body: { rev: 1, data: backup('2026-03-10') } });
  const r = await body(await call(env, `/asr/${SLOT}`, { method: 'POST', body: wav }));
  assert.deepEqual(r, { status: 200, json: { text: 'నమస్కారం' } });
});

test('signup → login → me → reset, adopting a KV slot into D1', async () => {
  const env = fakeEnv();
  // existing device data in KV
  await call(env, `/${SLOT}`, { method: 'PUT', body: { rev: 1, data: backup('2026-03-10', 5) } });

  // signup validation
  assert.equal((await call(env, '/auth/signup', { method: 'POST', body: { email: 'bad', authKey: authKey() } })).status, 400);
  assert.equal((await call(env, '/auth/signup', { method: 'POST', body: { email: 'a@b.co', authKey: 'short' } })).status, 400);

  const su = await body(
    await call(env, '/auth/signup', { method: 'POST', body: { email: '  Arnav@Example.com ', authKey: authKey('a'), slot: SLOT } }),
  );
  assert.equal(su.status, 201);
  assert.equal(su.json.slot, SLOT);
  assert.match(su.json.token, /^v1\./);
  assert.match(su.json.recoveryCode, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);

  // slot was promoted: D1 row exists with last_active_day, future reads come from D1
  const row = await env.DB.prepare('SELECT rev, last_active_day FROM progress WHERE slot_key = ?').bind(SLOT).first();
  assert.deepEqual(row, { rev: 1, last_active_day: '2026-03-10' });
  let r = await body(await call(env, `/${SLOT}`, { method: 'PUT', body: { rev: 2, data: backup('2026-03-12', 6) } }));
  assert.equal(r.status, 200);
  assert.equal(await env.DB.prepare('SELECT last_active_day FROM progress WHERE slot_key = ?').bind(SLOT).first('last_active_day'), '2026-03-12');
  assert.equal(JSON.parse(env.SYNC._map.get(`sync:${SLOT}`)).rev, 1); // KV copy untouched
  r = await body(await call(env, `/${SLOT}`));
  assert.equal(r.json.rev, 2);

  // duplicate email (any case) → 409
  assert.equal((await call(env, '/auth/signup', { method: 'POST', body: { email: 'ARNAV@example.com', authKey: authKey('9') } })).status, 409);

  // second account asking for the same slot gets a fresh one
  const su2 = await body(await call(env, '/auth/signup', { method: 'POST', body: { email: 'two@example.com', authKey: authKey('b'), slot: SLOT }, ip: '9.9.9.9' }));
  assert.equal(su2.status, 201);
  assert.notEqual(su2.json.slot, SLOT);
  assert.match(su2.json.slot, /^[a-f0-9]{56}$/);
  // fresh slot: placeholder row, reads as 404 until the first PUT, which then lands in D1
  assert.equal((await call(env, `/${su2.json.slot}`)).status, 404);
  assert.equal((await call(env, `/${su2.json.slot}`, { method: 'PUT', body: { rev: 1, data: backup('2026-03-01') }, ip: '9.9.9.9' })).status, 200);
  assert.equal(await env.DB.prepare('SELECT rev FROM progress WHERE slot_key = ?').bind(su2.json.slot).first('rev'), 1);
  assert.ok(!env.SYNC._map.has(`sync:${su2.json.slot}`));

  // login
  const li = await body(await call(env, '/auth/login', { method: 'POST', body: { email: 'arnav@example.com', authKey: authKey('a') } }));
  assert.equal(li.status, 200);
  assert.equal(li.json.slot, SLOT);
  const wrong = await body(await call(env, '/auth/login', { method: 'POST', body: { email: 'arnav@example.com', authKey: authKey('b') } }));
  const unknown = await body(await call(env, '/auth/login', { method: 'POST', body: { email: 'nobody@example.com', authKey: authKey('a') } }));
  assert.deepEqual(wrong, { status: 401, json: { error: 'invalid' } });
  assert.deepEqual(unknown, wrong);

  // me
  const me = await body(await call(env, '/auth/me', { headers: { authorization: `Bearer ${li.json.token}` } }));
  assert.deepEqual(me, { status: 200, json: { email: 'arnav@example.com', slot: SLOT, recovery: 'code' } });
  assert.equal((await call(env, '/auth/me')).status, 401);
  assert.equal((await call(env, '/auth/me', { headers: { authorization: 'Bearer nope' } })).status, 401);

  // reset: wrong code → 401; right code rotates key, token_ver and recovery code
  assert.equal(
    (await call(env, '/auth/reset', { method: 'POST', body: { email: 'arnav@example.com', recoveryCode: 'AAAA-AAAA-AAAA-AAAA-AAAA', authKey: authKey('c') } })).status,
    401,
  );
  const rs = await body(
    await call(env, '/auth/reset', {
      method: 'POST',
      body: { email: 'arnav@example.com', recoveryCode: su.json.recoveryCode.toLowerCase().replace(/-/g, ' '), authKey: authKey('c') },
    }),
  );
  assert.equal(rs.status, 200);
  assert.equal(rs.json.slot, SLOT);
  assert.notEqual(rs.json.recoveryCode, su.json.recoveryCode);
  // old token + old key + old recovery code are all dead
  assert.equal((await call(env, '/auth/me', { headers: { authorization: `Bearer ${li.json.token}` } })).status, 401);
  assert.equal((await call(env, '/auth/me', { headers: { authorization: `Bearer ${rs.json.token}` } })).status, 200);
  assert.equal((await call(env, '/auth/login', { method: 'POST', body: { email: 'arnav@example.com', authKey: authKey('a') } })).status, 401);
  assert.equal((await call(env, '/auth/login', { method: 'POST', body: { email: 'arnav@example.com', authKey: authKey('c') } })).status, 200);
  assert.equal(
    (await call(env, '/auth/reset', { method: 'POST', body: { email: 'arnav@example.com', recoveryCode: su.json.recoveryCode, authKey: authKey('d') } })).status,
    401,
  );
});

test('signup is rate limited per IP', async () => {
  const env = fakeEnv();
  let last;
  for (let i = 0; i < 6; i++) {
    last = await call(env, '/auth/signup', { method: 'POST', body: { email: `u${i}@x.io`, authKey: authKey('a') }, ip: '7.7.7.7' });
  }
  assert.equal(last.status, 429);
});

test('push subscribe/unsubscribe and the reminder sweep', async () => {
  const env = fakeEnv();
  const su = await body(await call(env, '/auth/signup', { method: 'POST', body: { email: 'p@x.io', authKey: authKey('a') }, ip: '5.5.5.5' }));
  const auth = { authorization: `Bearer ${su.json.token}` };
  const vapid = await body(await call(env, '/push/vapid'));
  assert.match(vapid.json.publicKey, /^[A-Za-z0-9_-]{87}$/);

  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
  const subscription = { endpoint: 'https://push.example.org/s/1', keys: { p256dh, auth: Buffer.alloc(16, 7).toString('base64url') } };
  const subBody = { subscription, tz: 'Asia/Kolkata', hh: 20, mm: 0, enabled: true };

  assert.equal((await call(env, '/push/subscribe', { method: 'POST', body: subBody })).status, 401);
  assert.equal((await call(env, '/push/subscribe', { method: 'POST', body: { ...subBody, tz: 'Nope/Nope' }, headers: auth })).status, 400);
  assert.equal((await call(env, '/push/subscribe', { method: 'POST', body: { ...subBody, hh: 24 }, headers: auth })).status, 400);
  assert.equal((await call(env, '/push/subscribe', { method: 'POST', body: subBody, headers: auth })).status, 200);
  // upsert by endpoint
  assert.equal((await call(env, '/push/subscribe', { method: 'POST', body: { ...subBody, mm: 5 }, headers: auth })).status, 200);
  const rows = (await env.DB.prepare('SELECT * FROM push_subs').all()).results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mm, 5);

  // sweep at 20:10 IST on 2026-03-10: due (target 20:05), user not active today
  const put = async (rev, day) =>
    (await call(env, `/${su.json.slot}`, { method: 'PUT', body: { rev, data: backup(day, 4) }, ip: '5.5.5.5' })).status;
  assert.equal(await put(1, '2026-03-09'), 200);
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, init });
    return new Response(null, { status: 201 });
  };
  const at = new Date('2026-03-10T14:40:00Z');
  assert.deepEqual(await runReminders(env, at, { fetchImpl }), { sent: 1, skipped: 0, dropped: 0 });
  assert.equal(sent[0].url, subscription.endpoint);
  assert.equal(sent[0].init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(await env.DB.prepare('SELECT last_sent_day FROM push_subs').first('last_sent_day'), '2026-03-10');
  // not sent twice the same day
  assert.deepEqual(await runReminders(env, at, { fetchImpl }), { sent: 0, skipped: 0, dropped: 0 });

  // next day: user already practised → skipped
  assert.equal(await put(2, '2026-03-11'), 200);
  const next = new Date('2026-03-11T14:40:00Z');
  assert.deepEqual(await runReminders(env, next, { fetchImpl }), { sent: 0, skipped: 1, dropped: 0 });

  // day after, push service says 410 → sub dropped
  assert.equal(await put(3, '2026-03-11'), 200);
  const gone = async () => new Response(null, { status: 410 });
  assert.deepEqual(await runReminders(env, new Date('2026-03-12T14:40:00Z'), { fetchImpl: gone }), { sent: 0, skipped: 0, dropped: 1 });
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first('n'), 0);

  // re-subscribe then DELETE
  assert.equal((await call(env, '/push/subscribe', { method: 'POST', body: subBody, headers: auth })).status, 200);
  assert.equal((await call(env, '/push/subscribe', { method: 'DELETE', body: { endpoint: subscription.endpoint }, headers: auth })).status, 200);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first('n'), 0);
});

test('birthday is the reset answer: signup, reset, lock after 5 misses, legacy account switches over', async () => {
  const env = fakeEnv();
  const post = (path, b, headers) => call(env, path, { method: 'POST', body: b, headers, ip: '6.6.6.6' });
  // bad dates are refused
  for (const [i, birthday] of ['2010-02-30', '14/05/2010', '1850-01-01', '2999-01-01', ''].entries()) {
    assert.equal((await call(env, '/auth/signup', { method: 'POST', ip: `7.7.7.${i}`, body: { email: 'kid@example.com', authKey: authKey('a'), birthday } })).status, 400, birthday);
  }
  const su = await body(await post('/auth/signup', { email: 'kid@example.com', authKey: authKey('a'), birthday: '2010-05-14' }));
  assert.equal(su.status, 201);
  assert.equal(su.json.recoveryCode, undefined);
  const stored = await env.DB.prepare('SELECT recovery_hash, recovery_kind FROM users WHERE email = ?').bind('kid@example.com').first();
  assert.equal(stored.recovery_kind, 'birthday');
  assert.doesNotMatch(stored.recovery_hash, /2010/);
  assert.equal((await body(await call(env, '/auth/me', { headers: { authorization: `Bearer ${su.json.token}` } }))).json.recovery, 'birthday');

  // wrong birthday → 401; right one resets and stays the answer
  assert.equal((await post('/auth/reset', { email: 'kid@example.com', birthday: '2010-05-15', authKey: authKey('b') })).status, 401);
  const rs = await body(await post('/auth/reset', { email: 'kid@example.com', birthday: '2010-05-14', authKey: authKey('b') }));
  assert.equal(rs.status, 200);
  assert.equal(rs.json.recoveryCode, undefined);
  assert.equal((await post('/auth/login', { email: 'kid@example.com', authKey: authKey('b') })).status, 200);
  assert.equal((await post('/auth/login', { email: 'kid@example.com', authKey: authKey('a') })).status, 401);
  assert.equal((await post('/auth/reset', { email: 'kid@example.com', birthday: '2010-05-14', authKey: authKey('c') })).status, 200);

  // five misses lock resets for a day, even for the right answer; sign-in still works
  for (let i = 1; i <= 5; i++) {
    assert.equal((await call(env, '/auth/reset', { method: 'POST', ip: `9.9.9.${i}`, body: { email: 'kid@example.com', birthday: `2011-01-0${i}`, authKey: authKey('d') } })).status, 401);
  }
  assert.equal((await call(env, '/auth/reset', { method: 'POST', ip: '9.9.8.1', body: { email: 'kid@example.com', birthday: '2010-05-14', authKey: authKey('d') } })).status, 429);
  assert.equal((await call(env, '/auth/login', { method: 'POST', ip: '9.9.8.2', body: { email: 'kid@example.com', authKey: authKey('c') } })).status, 200);
  await env.DB.prepare('UPDATE users SET reset_locked_until = 1').run();
  assert.equal((await call(env, '/auth/reset', { method: 'POST', ip: '9.9.8.3', body: { email: 'kid@example.com', birthday: '2010-05-14', authKey: authKey('d') } })).status, 200);

  // an older account (recovery code) adds a birthday while signed in; the code stops working
  const old = await body(await call(env, '/auth/signup', { method: 'POST', ip: '8.8.8.1', body: { email: 'old@example.com', authKey: authKey('a') } }));
  assert.match(old.json.recoveryCode, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  assert.equal((await post('/auth/birthday', { birthday: '1975-12-01' })).status, 401);
  assert.equal((await post('/auth/birthday', { birthday: 'nope' }, { authorization: `Bearer ${old.json.token}` })).status, 400);
  assert.equal((await post('/auth/birthday', { birthday: '1975-12-01' }, { authorization: `Bearer ${old.json.token}` })).status, 200);
  assert.equal((await call(env, '/auth/reset', { method: 'POST', ip: '8.8.8.2', body: { email: 'old@example.com', recoveryCode: old.json.recoveryCode, authKey: authKey('e') } })).status, 401);
  assert.equal((await call(env, '/auth/reset', { method: 'POST', ip: '8.8.8.3', body: { email: 'old@example.com', birthday: '1975-12-01', authKey: authKey('e') } })).status, 200);
});
