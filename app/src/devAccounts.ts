// Practice accounts for the DEVELOPER VERSION only. They behave like real
// accounts (create, sign in, reset by birthday, five-miss lock) but live in
// this browser's storage, so testing never creates or touches a real Chilaka
// account. Progress still syncs to the practice account's own slot, so signing
// in after "Start over" brings the name, level and lessons back, as it would
// for a real account. Never used in the released app.

const STORE = 'chilaka.devAccounts';

interface Practice {
  authKey: string;
  birthday: string;
  slot: string;
  ver: number;
  fails: number;
  lockedUntil: number;
}

function load(): Record<string, Practice> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Practice>;
  } catch {
    return {};
  }
}
const save = (all: Record<string, Practice>) => localStorage.setItem(STORE, JSON.stringify(all));
const token = (email: string, ver: number) => `dev.${btoa(email)}.${ver}`;
const randomSlot = () => [...crypto.getRandomValues(new Uint8Array(28))].map((b) => b.toString(16).padStart(2, '0')).join('');

export class DevApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Same paths, bodies and error codes as the real server (sync-worker/src/index.js). */
export function devApi(path: string, body?: unknown, bearer?: string): unknown {
  const all = load();
  const b = (body ?? {}) as { email?: string; authKey?: string; birthday?: string; slot?: string };
  const who = () => {
    const m = /^dev\.([^.]+)\.(\d+)$/.exec(bearer ?? '');
    const email = m ? atob(m[1]) : '';
    return m && all[email]?.ver === Number(m[2]) ? email : null;
  };
  if (path === '/auth/signup') {
    if (!b.email || !b.authKey || !b.birthday) throw new DevApiError('bad birthday');
    if (all[b.email]) throw new DevApiError('exists');
    const taken = Object.values(all).some((u) => u.slot === b.slot);
    const slot = b.slot && !taken ? b.slot : randomSlot();
    all[b.email] = { authKey: b.authKey, birthday: b.birthday, slot, ver: 1, fails: 0, lockedUntil: 0 };
    save(all);
    return { token: token(b.email, 1), slot };
  }
  if (path === '/auth/login') {
    const u = all[b.email ?? ''];
    if (!u || u.authKey !== b.authKey) throw new DevApiError('invalid');
    return { token: token(b.email!, u.ver), slot: u.slot };
  }
  if (path === '/auth/reset') {
    const u = all[b.email ?? ''];
    if (!u) throw new DevApiError('invalid');
    if (u.lockedUntil > Date.now()) throw new DevApiError('locked');
    if (u.birthday !== b.birthday) {
      u.fails += 1;
      if (u.fails >= 5) {
        u.fails = 0;
        u.lockedUntil = Date.now() + 24 * 60 * 60_000;
      }
      save(all);
      throw new DevApiError('invalid');
    }
    Object.assign(u, { authKey: b.authKey!, ver: u.ver + 1, fails: 0, lockedUntil: 0 });
    save(all);
    return { token: token(b.email!, u.ver), slot: u.slot };
  }
  const email = who();
  if (!email) throw new DevApiError('401');
  if (path === '/auth/me') return { email, slot: all[email].slot, recovery: 'birthday' };
  if (path === '/auth/birthday') {
    all[email].birthday = b.birthday ?? all[email].birthday;
    save(all);
    return { ok: true };
  }
  throw new DevApiError('404');
}

/**
 * "Start over as a new user": forget everything on this device except the
 * practice accounts, then reload, so the welcome and first-run screens show
 * again and signing back in can be tested.
 */
export async function devStartOver(): Promise<void> {
  const keep = localStorage.getItem(STORE);
  const dbs = await indexedDB.databases();
  await Promise.all(
    dbs.map(
      (d) =>
        new Promise<void>((resolve) => {
          if (!d.name) return resolve();
          const req = indexedDB.deleteDatabase(d.name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        }),
    ),
  );
  localStorage.clear();
  if (keep) localStorage.setItem(STORE, keep);
  location.reload();
}
