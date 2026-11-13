// Owner sign-in. The password is stretched in the browser (PBKDF2, see
// public/app.js) and only the derived key is sent; the worker keeps a salted
// SHA-256 of that key as the ADMIN_PASSWORD_HASH secret, so neither the
// password nor anything that can be replayed as it is stored anywhere.

const enc = new TextEncoder();
export const SESSION_TTL = 12 * 3600; // seconds
export const COOKIE = '__Host-chilaka_admin';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** Same length, compared without an early exit. */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** "v1$<salt hex>$<sha256 hex>" → parts, or null when the secret is missing / malformed. */
export function parseSecret(secret) {
  const m = /^v1\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(String(secret || '').trim());
  return m ? { salt: m[1], hash: m[2] } : null;
}

/** The value to store as ADMIN_PASSWORD_HASH for a derived key (used by tools/admin-password.mjs). */
export async function makeSecret(authKey, saltHex) {
  return `v1$${saltHex}$${await sha256Hex(`${saltHex}:${authKey}`)}`;
}

export async function verifyKey(secret, authKey) {
  const parts = parseSecret(secret);
  if (!parts || !/^[0-9a-f]{64}$/.test(String(authKey || ''))) return false;
  return sameText(await sha256Hex(`${parts.salt}:${authKey}`), parts.hash);
}

async function sign(secret, text) {
  // keyed by the stored secret: changing the password signs everyone out
  const key = await crypto.subtle.importKey('raw', enc.encode(`chilaka-admin-session|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

export async function signSession(secret, nowSec, ttl = SESSION_TTL) {
  const exp = Math.floor(nowSec) + ttl;
  return `${exp}.${await sign(secret, String(exp))}`;
}

export async function verifySession(secret, token, nowSec) {
  if (!parseSecret(secret)) return false;
  const m = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(String(token || ''));
  if (!m || Number(m[1]) <= nowSec) return false;
  return sameText(await sign(secret, m[1]), m[2]);
}

export function readCookie(request, name = COOKIE) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export const sessionCookie = (token, maxAge = SESSION_TTL) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// ---- sign-in attempt limits (KV counters; soft, but the password is long) ----

export const LIMIT = { perIp: 5, perIpWindow: 900, global: 200, globalWindow: 3600 };

async function count(kv, key) {
  return Number((await kv.get(key)) || 0);
}

export async function tooManyAttempts(kv, ipKey) {
  const [mine, all] = await Promise.all([count(kv, `admin:rl:${ipKey}`), count(kv, 'admin:rl:all')]);
  return mine >= LIMIT.perIp || all >= LIMIT.global;
}

export async function recordFailure(kv, ipKey) {
  const [mine, all] = await Promise.all([count(kv, `admin:rl:${ipKey}`), count(kv, 'admin:rl:all')]);
  await Promise.all([
    kv.put(`admin:rl:${ipKey}`, String(mine + 1), { expirationTtl: LIMIT.perIpWindow }),
    kv.put('admin:rl:all', String(all + 1), { expirationTtl: LIMIT.globalWindow }),
  ]);
}

export async function clearFailures(kv, ipKey) {
  await kv.delete(`admin:rl:${ipKey}`);
}

export async function ipKeyOf(request) {
  return (await sha256Hex(`ip|${request.headers.get('cf-connecting-ip') || 'unknown'}`)).slice(0, 24);
}

/**
 * This-laptop-only lock. When the ADMIN_DEVICE_HASH secret is set (64 hex =
 * SHA-256 of a random key that lives only in the Chilaka Owner app's folder on
 * the owner's Mac), every request must carry that key in `x-chilaka-device`.
 * A browser, a phone or another computer does not have it. The password is
 * still needed on top. Not set: the lock is off and the page works in a browser.
 */
export const DEVICE_HEADER = 'x-chilaka-device';
export function deviceLockOn(env) {
  return /^[0-9a-f]{64}$/.test(env.ADMIN_DEVICE_HASH || '');
}
export async function deviceAllowed(request, env) {
  if (!deviceLockOn(env)) return true;
  const key = request.headers.get(DEVICE_HEADER) || '';
  return sameText(await sha256Hex(`device|${key}`), env.ADMIN_DEVICE_HASH) && key.length >= 32;
}
