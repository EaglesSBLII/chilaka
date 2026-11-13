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
            : code === 'locked'
              ? 'Too many wrong answers. Password reset is locked for this account until tomorrow.'
              : code === 'bad birthday'
                ? 'Enter your full date of birth.'
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

/** A real date of birth in the past, as the date field gives it (YYYY-MM-DD). */
export function validBirthday(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDate() === Number(m[3]) && d.getUTCMonth() === Number(m[2]) - 1 && Number(m[1]) >= 1900 && d.getTime() <= Date.now();
}

/** The birthday is the answer for a password reset; the server keeps only a hash of it. */
export async function signup(email: string, password: string, birthday: string): Promise<{ session: Session }> {
  const authKey = await deriveAuthKey(email, password);
  const r = await api<{ token: string; slot: string }>('/auth/signup', {
    email: normalizeEmail(email),
    authKey,
    birthday,
    slot: sync.key || undefined, // the device's current slot becomes the account's
  });
  const session = { token: r.token, email: normalizeEmail(email), slot: r.slot };
  await saveSession(session);
  await adoptSlot(r.slot);
  return { session };
}

export async function login(email: string, password: string): Promise<Session> {
  const authKey = await deriveAuthKey(email, password);
  const r = await api<{ token: string; slot: string }>('/auth/login', { email: normalizeEmail(email), authKey });
  const session = { token: r.token, email: normalizeEmail(email), slot: r.slot };
  await saveSession(session);
  await adoptSlot(r.slot);
  return session;
}

/**
 * Reset with the birthday given at sign-up. Accounts made before birthdays
 * still answer with their recovery code and get a fresh code back.
 */
export async function reset(
  email: string,
  answer: { birthday: string } | { recoveryCode: string },
  newPassword: string,
): Promise<{ session: Session; recoveryCode?: string }> {
  const authKey = await deriveAuthKey(email, newPassword);
  const r = await api<{ token: string; slot: string; recoveryCode?: string }>('/auth/reset', {
    email: normalizeEmail(email),
    ...('birthday' in answer ? { birthday: answer.birthday } : { recoveryCode: answer.recoveryCode.trim() }),
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

/** How this account resets its password: 'birthday', or 'code' for accounts made before birthdays. */
export async function recoveryKind(session: Session): Promise<'birthday' | 'code' | null> {
  try {
    const r = await api<{ recovery?: 'birthday' | 'code' }>('/auth/me', undefined, session.token);
    return r.recovery ?? null;
  } catch {
    return null;
  }
}

/** Signed-in owner sets the birthday used for password resets (replaces a recovery code). */
export async function setBirthday(session: Session, birthday: string): Promise<void> {
  await api<{ ok: boolean }>('/auth/birthday', { birthday }, session.token);
}
