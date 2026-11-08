import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptPayload,
  decryptPayload,
  vapidJwt,
  getVapidKeys,
  vapidPublicKeyString,
  sendPush,
  _resetVapidCache,
} from '../src/lib/push.js';
import { b64url, b64urlDecode } from '../src/lib/auth.js';
import { fakeEnv } from './helpers.mjs';

// A browser-side subscription: ECDH P-256 pair + 16-byte auth secret.
async function fakeSubscriber() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { p256dh: b64url(raw), auth: b64url(auth), priv };
}

test('aes128gcm: encrypt → decrypt round trip with RFC 8188 header', async () => {
  const sub = await fakeSubscriber();
  const msg = JSON.stringify({ title: 'Time for Telugu', body: 'Chikki saved a short lesson for you 🦜' });
  const body = await encryptPayload(sub.p256dh, sub.auth, msg);
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096); // rs
  assert.equal(body[20], 65); // idlen
  assert.equal(body[21], 4); // uncompressed point marker
  assert.equal(body.length, 21 + 65 + new TextEncoder().encode(msg).length + 1 + 16);
  assert.equal(await decryptPayload(sub.priv, sub.auth, body), msg);
  // a different subscriber cannot read it
  const other = await fakeSubscriber();
  await assert.rejects(decryptPayload(other.priv, other.auth, body));
});

test('VAPID: keys minted once, public key is a 65-byte point, JWT is ES256 with the right claims', async () => {
  _resetVapidCache();
  const env = fakeEnv({ d1: false });
  const keys = await getVapidKeys(env);
  assert.ok(await env.SYNC.get('cfg:vapid'));
  _resetVapidCache();
  assert.deepEqual(await getVapidKeys(env), keys);

  const pub = vapidPublicKeyString(keys.publicKey);
  assert.equal(b64urlDecode(pub).length, 65);

  const jwt = await vapidJwt(keys, 'https://push.example.org', Date.UTC(2026, 0, 1));
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  const dec = (s) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
  assert.deepEqual(dec(parts[0]), { typ: 'JWT', alg: 'ES256' });
  const claims = dec(parts[1]);
  assert.equal(claims.aud, 'https://push.example.org');
  assert.equal(claims.exp, Date.UTC(2026, 0, 1) / 1000 + 12 * 3600);
  assert.match(claims.sub, /^mailto:/);
  assert.equal(b64urlDecode(parts[2]).length, 64); // raw r||s

  const verifyKey = await crypto.subtle.importKey('jwk', keys.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    b64urlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  assert.equal(ok, true);
  _resetVapidCache();
});

test('sendPush posts an encrypted body with VAPID headers and returns the status', async () => {
  _resetVapidCache();
  const env = fakeEnv({ d1: false });
  const sub = await fakeSubscriber();
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response(null, { status: 201 });
  };
  const status = await sendPush(env, { endpoint: 'https://push.example.org/send/abc', ...sub }, { title: 'hi' }, { fetchImpl });
  assert.equal(status, 201);
  assert.equal(seen.url, 'https://push.example.org/send/abc');
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.init.headers.TTL, '21600');
  assert.match(seen.init.headers.Authorization, /^vapid t=[A-Za-z0-9_.-]+,k=[A-Za-z0-9_-]+$/);
  assert.equal(await decryptPayload(sub.priv, sub.auth, seen.init.body), JSON.stringify({ title: 'hi' }));
  _resetVapidCache();
});
