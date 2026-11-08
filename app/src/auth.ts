// Accounts: email + password, no email sending. The password never leaves the
// device — we stretch it with PBKDF2 (300k rounds) and send the derived key;
// the Worker salts and hashes that again. Signing in adopts the account's sync
// slot, and the existing merge folds local progress into it.
import { db } from './db/schema';
import { sync } from './sync';
import { SYNC_ENDPOINT } from './sync-config';

export interface Session {
  token: string;
  email: string;
  slot: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

const KEYS = { token: 'syncAuthToken', email: 'syncAuthEmail', slot: 'syncAuthSlot' } as const;
const ROUNDS = 300_000;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

/** Slow client-side stretch; the salt is derived from the email so it is stable across devices. */
export async function deriveAuthKey(email: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = await crypto.subtle.digest('SHA-256', enc.encode(`chilaka-v1:${normalizeEmail(email)}`));
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ROUNDS }, base, 256);
  return hex(bits);
}

async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SYNC_ENDPOINT}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AuthError('No connection. Try again when you are online.', 'offline');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    const code = data.error ?? String(res.status);
    const msg =
      code === 'exists'
        ? 'There is already an account with that email.'
        : code === 'invalid'
          ? 'Email or password is wrong.'
          : code === 'rate'
            ? 'Too many attempts. Wait a few minutes.'
            : code === '503'
              ? 'Accounts are not switched on yet on the server. Your progress is still saved on this device.'
              : 'Something went wrong. Try again.';
    throw new AuthError(msg, code);
  }
  return data;
}

export async function getSession(): Promise<Session | null> {
  const rows = await db.settings.bulkGet([KEYS.token, KEYS.email, KEYS.slot]);
  const [token, email, slot] = rows.map((r) => r?.value as string | undefined);
  return token && email && slot ? { token, email, slot } : null;
}

async function saveSession(s: Session): Promise<void> {
  await db.settings.bulkPut([
    { key: KEYS.token, value: s.token },
    { key: KEYS.email, value: s.email },
    { key: KEYS.slot, value: s.slot },
  ]);
}

/** Point sync at the account's slot and merge local progress into it right away. */
async function adoptSlot(slot: string): Promise<void> {
  await sync.useSlot(SYNC_ENDPOINT, slot);
  await sync.syncNow();
}

export async function signup(email: string, password: string): Promise<{ session: Session; recoveryCode: string }> {
  const authKey = await deriveAuthKey(email, password);
  const r = await api<{ token: string; slot: string; recoveryCode: string }>('/auth/signup', {
    email: normalizeEmail(email),
    authKey,
    slot: sync.key || undefined, // the device's current slot becomes the account's
  });
  const session = { token: r.token, email: normalizeEmail(email), slot: r.slot };
  await saveSession(session);
  await adoptSlot(r.slot);
  return { session, recoveryCode: r.recoveryCode };
}

export async function login(email: string, password: string): Promise<Session> {
  const authKey = await deriveAuthKey(email, password);
  const r = await api<{ token: string; slot: string }>('/auth/login', { email: normalizeEmail(email), authKey });
  const session = { token: r.token, email: normalizeEmail(email), slot: r.slot };
  await saveSession(session);
  await adoptSlot(r.slot);
  return session;
}

export async function reset(email: string, recoveryCode: string, newPassword: string): Promise<{ session: Session; recoveryCode: string }> {
  const authKey = await deriveAuthKey(email, newPassword);
  const r = await api<{ token: string; slot: string; recoveryCode: string }>('/auth/reset', {
    email: normalizeEmail(email),
    recoveryCode: recoveryCode.trim(),
    authKey,
  });
  const session = { token: r.token, email: normalizeEmail(email), slot: r.slot };
  await saveSession(session);
  await adoptSlot(r.slot);
  return { session, recoveryCode: r.recoveryCode };
}

/** Sign out. The device keeps syncing the same slot (progress stays); `forget` mints a fresh one. */
export async function logout(forget = false): Promise<void> {
  await db.settings.bulkDelete([KEYS.token, KEYS.email, KEYS.slot]);
  if (forget) await sync.setUp(SYNC_ENDPOINT);
}

/** Ask the server whether the stored token is still valid. */
export async function me(session: Session): Promise<boolean> {
  try {
    await api<{ email: string }>('/auth/me', undefined, session.token);
    return true;
  } catch (e) {
    if (e instanceof AuthError && e.code === 'offline') return true; // keep the session while offline
    return false;
  }
}
