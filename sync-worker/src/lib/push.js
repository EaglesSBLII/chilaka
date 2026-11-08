// Web Push without dependencies: VAPID (RFC 8292, ES256) + aes128gcm content
// encryption (RFC 8188 / RFC 8291) on WebCrypto.

import { b64url, b64urlDecode } from './auth.js';

const enc = new TextEncoder();
const RECORD_SIZE = 4096;
const VAPID_SUB = 'mailto:chilaka@example.com';
const P256 = { name: 'ECDH', namedCurve: 'P-256' };

// ---- VAPID keys (JWK pair minted once into KV `cfg:vapid`) ----
let cachedVapid = null;

export async function getVapidKeys(env) {
  if (cachedVapid) return cachedVapid;
  let pair = await env.SYNC.get('cfg:vapid', 'json');
  if (!pair) {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    pair = {
      publicKey: await crypto.subtle.exportKey('jwk', k.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', k.privateKey),
    };
    await env.SYNC.put('cfg:vapid', JSON.stringify(pair));
    pair = (await env.SYNC.get('cfg:vapid', 'json')) ?? pair; // settle a first-run race
  }
  cachedVapid = pair;
  return pair;
}

export function _resetVapidCache() {
  cachedVapid = null;
}

// Uncompressed P-256 point (0x04 || x || y) as base64url — what
// PushManager.subscribe({applicationServerKey}) expects.
export function vapidPublicKeyString(jwkPublic) {
  const x = b64urlDecode(jwkPublic.x);
  const y = b64urlDecode(jwkPublic.y);
  const raw = new Uint8Array(65);
  raw[0] = 4;
  raw.set(x, 1);
  raw.set(y, 33);
  return b64url(raw);
}

export async function vapidJwt(keys, audience, now = Date.now()) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(
    enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: VAPID_SUB })),
  );
  const key = await crypto.subtle.importKey('jwk', keys.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto ECDSA yields raw r||s, which is the JWS form.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

// ---- aes128gcm ----
async function hkdf(salt, ikm, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// RFC 8291 §3: IKM from ECDH secret + auth secret, then CEK/nonce (RFC 8188).
async function deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt) {
  const info = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, info, 256);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  return { cek, nonce };
}

// → Uint8Array body: salt(16) | rs(4) | idlen(1) | as_public(65) | ciphertext.
export async function encryptPayload(p256dhB64, authB64, plaintext) {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, P256, false, []);
  const asPair = await crypto.subtle.generateKey(P256, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asPair.publicKey));
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPair.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { cek, nonce } = await deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt);

  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  if (data.length + 1 + 16 > RECORD_SIZE) throw new Error('payload too large for one record');
  const padded = concat(data, Uint8Array.of(2)); // 0x02 = last record delimiter
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ct);
}

// Test-only: the browser side of RFC 8291. `uaPrivateJwk` is the subscriber's
// ECDH private key, `authB64` its auth secret. → plaintext string.
export async function decryptPayload(uaPrivateJwk, authB64, body) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const authSecret = b64urlDecode(authB64);
  const uaPriv = await crypto.subtle.importKey('jwk', uaPrivateJwk, P256, false, ['deriveBits']);
  const uaPublic = b64urlDecode(vapidPublicKeyString(uaPrivateJwk)); // same 0x04||x||y encoding
  const asKey = await crypto.subtle.importKey('raw', asPublic, P256, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPriv, 256));
  const { cek, nonce } = await deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ct));
  const delim = padded.lastIndexOf(2);
  return new TextDecoder().decode(padded.slice(0, delim));
}

// Sends one push to a subscription row {endpoint, p256dh, auth}.
// → HTTP status from the push service (callers drop the sub on 404/410).
export async function sendPush(env, sub, payloadObj, { ttl = 6 * 3600, fetchImpl = fetch } = {}) {
  const keys = await getVapidKeys(env);
  const origin = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(keys, origin);
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(payloadObj));
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(ttl),
      Urgency: 'normal',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      Authorization: `vapid t=${jwt},k=${vapidPublicKeyString(keys.publicKey)}`,
    },
    body,
  });
  return res.status;
}
