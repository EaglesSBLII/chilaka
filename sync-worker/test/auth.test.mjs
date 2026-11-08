import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signTokenWith,
  verifyTokenWith,
  signToken,
  verifyToken,
  getSecret,
  _resetSecretCache,
  newCredential,
  checkAuthKey,
  constantTimeEqual,
  makeRecoveryCode,
  normaliseRecoveryCode,
  hashRecoveryCode,
  checkRecoveryCode,
  TOKEN_TTL_MS,
} from '../src/lib/auth.js';
import { fakeEnv, authKey } from './helpers.mjs';

const SECRET = 'ab'.repeat(32);

test('token: sign → verify round trip', async () => {
  const payload = { uid: 'u1', slot: 'f'.repeat(56), ver: 1, exp: Date.now() + 60_000 };
  const tok = await signTokenWith(SECRET, payload);
  assert.match(tok, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await verifyTokenWith(SECRET, tok), payload);
});

test('token: tampered payload or signature is rejected', async () => {
  const tok = await signTokenWith(SECRET, { uid: 'u1', slot: 's', ver: 1, exp: Date.now() + 60_000 });
  const [v, body, sig] = tok.split('.');
  const otherBody = Buffer.from(JSON.stringify({ uid: 'u2', slot: 's', ver: 1, exp: Date.now() + 60_000 })).toString('base64url');
  assert.equal(await verifyTokenWith(SECRET, `${v}.${otherBody}.${sig}`), null);
  assert.equal(await verifyTokenWith(SECRET, `${v}.${body}.${sig.slice(0, -2)}AA`), null);
  assert.equal(await verifyTokenWith('cd'.repeat(32), tok), null);
  assert.equal(await verifyTokenWith(SECRET, 'v0.x.y'), null);
  assert.equal(await verifyTokenWith(SECRET, 'garbage'), null);
});

test('token: expiry is enforced', async () => {
  const tok = await signTokenWith(SECRET, { uid: 'u1', slot: 's', ver: 1, exp: 1000 });
  assert.equal(await verifyTokenWith(SECRET, tok, 1000), null);
  assert.ok(await verifyTokenWith(SECRET, tok, 999));
});

test('token: secret is minted once into KV and token_ver is checked', async () => {
  _resetSecretCache();
  const env = fakeEnv();
  const s1 = await getSecret(env);
  assert.match(s1, /^[a-f0-9]{64}$/);
  assert.equal(await env.SYNC.get('cfg:authSecret'), s1);
  _resetSecretCache();
  assert.equal(await getSecret(env), s1);

  await env.DB.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind('u1', 'a@b.co', 'h', 's', 'r', 'f'.repeat(56), 1, Date.now())
    .run();
  const tok = await signToken(env, { uid: 'u1', slot: 'f'.repeat(56), ver: 1 });
  const who = await verifyToken(env, `Bearer ${tok}`);
  assert.deepEqual(who, { uid: 'u1', slot: 'f'.repeat(56), email: 'a@b.co' });
  assert.equal(await verifyToken(env, tok), null); // no Bearer prefix
  await env.DB.prepare('UPDATE users SET token_ver = 2 WHERE id = ?').bind('u1').run();
  assert.equal(await verifyToken(env, `Bearer ${tok}`), null);
  const payload = await verifyTokenWith(await getSecret(env), tok);
  assert.ok(payload.exp - Date.now() > TOKEN_TTL_MS - 5000);
  _resetSecretCache();
});

test('auth hash: salted, verifies, rejects wrong key', async () => {
  const { serverSalt, authHash } = await newCredential(authKey('a'));
  assert.match(serverSalt, /^[a-f0-9]{32}$/);
  assert.match(authHash, /^[a-f0-9]{64}$/);
  assert.equal(await checkAuthKey(serverSalt, authHash, authKey('a')), true);
  assert.equal(await checkAuthKey(serverSalt, authHash, authKey('b')), false);
  const again = await newCredential(authKey('a'));
  assert.notEqual(again.authHash, authHash); // different salt → different hash
});

test('constantTimeEqual', () => {
  assert.equal(constantTimeEqual('abcd', 'abcd'), true);
  assert.equal(constantTimeEqual('abcd', 'abce'), false);
  assert.equal(constantTimeEqual('abcd', 'abc'), false);
  assert.equal(constantTimeEqual(undefined, 'abc'), false);
});

test('recovery code: format, normalise, hash compare', async () => {
  const code = makeRecoveryCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$/);
  assert.equal(normaliseRecoveryCode(` ${code.toLowerCase().replace(/-/g, ' ')} `), code.replace(/-/g, ''));
  const hash = await hashRecoveryCode(code);
  assert.equal(await checkRecoveryCode(code.toLowerCase(), hash), true);
  assert.equal(await checkRecoveryCode(code.replace(/-/g, ''), hash), true);
  assert.equal(await checkRecoveryCode(makeRecoveryCode(), hash), false);
});
