// Account auth primitives (pure WebCrypto, no PBKDF2 on the server).
// Clients derive a 32-byte authKey from their password with PBKDF2 and send
// its hex; the server stores hex(SHA-256(serverSalt || authKey)).

const enc = new TextEncoder();

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(nBytes) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(nBytes)));
}

export function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sha256Hex(bytes) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

// Compares two equal-length hex strings without short-circuiting.
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const isAuthKey = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);

export async function hashAuthKey(serverSaltHex, authKeyHex) {
  const salt = hexToBytes(serverSaltHex);
  const key = hexToBytes(authKeyHex);
  const joined = new Uint8Array(salt.length + key.length);
  joined.set(salt);
  joined.set(key, salt.length);
  return sha256Hex(joined);
}

export async function newCredential(authKeyHex) {
  const serverSalt = randomHex(16);
  return { serverSalt, authHash: await hashAuthKey(serverSalt, authKeyHex) };
}

export async function checkAuthKey(serverSaltHex, authHashHex, authKeyHex) {
  return constantTimeEqual(await hashAuthKey(serverSaltHex, authKeyHex), authHashHex);
}

// ---- recovery codes ----
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // base32-ish, no 0/1/O/I

export function makeRecoveryCode() {
  const rnd = crypto.getRandomValues(new Uint8Array(20));
  let raw = '';
  for (const b of rnd) raw += ALPHABET[b % 32];
  return raw.match(/.{4}/g).join('-');
}

export function normaliseRecoveryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[\s-]/g, '');
}

export async function hashRecoveryCode(code) {
  return sha256Hex(enc.encode(normaliseRecoveryCode(code)));
}

export async function checkRecoveryCode(code, storedHash) {
  return constantTimeEqual(await hashRecoveryCode(code), storedHash);
}

// ---- tokens: v1.<b64url(JSON{uid, slot, ver, exp})>.<b64url(HMAC-SHA256)> ----
export const TOKEN_TTL_MS = 90 * 24 * 60 * 60_000;

let cachedSecret = null;

// Signing secret is minted once into KV and cached per isolate.
export async function getSecret(env) {
  if (cachedSecret) return cachedSecret;
  let hex = await env.SYNC.get('cfg:authSecret');
  if (!hex) {
    hex = randomHex(32);
    await env.SYNC.put('cfg:authSecret', hex);
    hex = (await env.SYNC.get('cfg:authSecret')) ?? hex; // settle a first-run race
  }
  cachedSecret = hex;
  return hex;
}

export function _resetSecretCache() {
  cachedSecret = null;
}

async function hmacKey(secretHex) {
  return crypto.subtle.importKey('raw', hexToBytes(secretHex), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signTokenWith(secretHex, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secretHex), enc.encode(`v1.${body}`));
  return `v1.${body}.${b64url(new Uint8Array(sig))}`;
}

// → payload or null. Checks shape, signature and expiry only.
export async function verifyTokenWith(secretHex, token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  let sig;
  try {
    sig = b64urlDecode(parts[2]);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secretHex), sig, enc.encode(`v1.${parts[1]}`));
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp <= now) return null;
  return payload;
}

export async function signToken(env, { uid, slot, ver }) {
  return signTokenWith(await getSecret(env), { uid, slot, ver, exp: Date.now() + TOKEN_TTL_MS });
}

// Verifies an `Authorization: Bearer …` header against the user's current
// token_ver. → {uid, slot, email} or null.
export async function verifyToken(env, header) {
  if (!env.DB) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m) return null;
  const payload = await verifyTokenWith(await getSecret(env), m[1]);
  if (!payload) return null;
  const user = await env.DB.prepare('SELECT email, slot_key, token_ver FROM users WHERE id = ?').bind(payload.uid).first();
  if (!user || user.token_ver !== payload.ver) return null;
  return { uid: payload.uid, slot: user.slot_key, email: user.email };
}
