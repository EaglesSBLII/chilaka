// In-memory stand-in for the sync Worker (accounts + slots), shared by the
// account and first-run specs.
import type { BrowserContext, Route } from '@playwright/test';
import { SYNC_ENDPOINT } from '../../src/sync-config';

export const kv = new Map<string, { rev: number; updatedAt: number; data: unknown }>();
export const users = new Map<string, { authKey: string; slot: string; recovery: string; kind: 'birthday' | 'code'; ver: number }>();
export const RECOVERY = 'ABCD-EFGH-JKLM-NPQR-STUV';
export const RECOVERY2 = 'WXYZ-2345-6789-ABCD-EFGH';

function token(email: string): string {
  const u = users.get(email)!;
  return `v1.${Buffer.from(JSON.stringify({ email, ver: u.ver })).toString('base64url')}.sig`;
}

export async function mockWorker(context: BrowserContext): Promise<void> {
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: cors, body: JSON.stringify(body) });
    const body = (): Record<string, string> => JSON.parse(req.postData() ?? '{}') as Record<string, string>;
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type, authorization, x-chilaka-hint',
        },
      });
    }
    if (url.pathname === '/auth/signup') {
      const b = body();
      if (users.has(b.email)) return json(409, { error: 'exists' });
      const slot = b.slot && !/[^0-9a-f]/.test(b.slot) ? b.slot : 'cd'.repeat(28);
      users.set(b.email, { authKey: b.authKey, slot, recovery: b.birthday, kind: 'birthday', ver: 1 });
      return json(201, { token: token(b.email), slot });
    }
    if (url.pathname === '/auth/login') {
      const b = body();
      const u = users.get(b.email);
      if (!u || u.authKey !== b.authKey) return json(401, { error: 'invalid' });
      return json(200, { token: token(b.email), slot: u.slot });
    }
    if (url.pathname === '/auth/reset') {
      const b = body();
      const u = users.get(b.email);
      const answer = u?.kind === 'birthday' ? b.birthday : b.recoveryCode?.toUpperCase();
      if (!u || u.recovery !== answer) return json(401, { error: 'invalid' });
      u.authKey = b.authKey;
      u.ver++;
      if (u.kind === 'birthday') return json(200, { token: token(b.email), slot: u.slot });
      u.recovery = RECOVERY2;
      return json(200, { token: token(b.email), slot: u.slot, recoveryCode: RECOVERY2 });
    }
    const signedIn = (): string | undefined => {
      const t = (req.headers()['authorization'] ?? '').split('.')[1];
      return t ? (JSON.parse(Buffer.from(t, 'base64url').toString()) as { email: string }).email : undefined;
    };
    if (url.pathname === '/auth/me') return json(200, { email: 'x', slot: 'y', recovery: users.get(signedIn() ?? '')?.kind ?? 'birthday' });
    if (url.pathname === '/auth/birthday') {
      const u = users.get(signedIn() ?? '');
      if (!u) return json(401, { error: 'unauthorized' });
      u.recovery = body().birthday;
      u.kind = 'birthday';
      return json(200, { ok: true });
    }
    // legacy sync slot routes
    const key = url.pathname.slice(1);
    if (req.method() === 'GET') {
      const cur = kv.get(key);
      return cur ? json(200, cur) : json(404, {});
    }
    if (req.method() === 'PUT') {
      const b = JSON.parse(req.postData() ?? '{}') as { rev: number; data: unknown };
      const curRev = kv.get(key)?.rev ?? 0;
      if (b.rev !== curRev + 1) return json(409, { conflict: true, rev: curRev });
      kv.set(key, { rev: b.rev, updatedAt: 1, data: b.data });
      return json(200, { rev: b.rev });
    }
    return json(405, {});
  };
  await context.route(`${SYNC_ENDPOINT}/**`, handler);
}
