// Accounts: device A signs up (its slot becomes the account's), a fresh device
// B signs in and receives the progress; recovery resets the password. The
// Worker is an in-memory mock shared by both contexts.
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { completeLesson, completeOnboarding, wipeState } from './helpers';
import { SYNC_ENDPOINT } from '../../src/sync-config';

const kv = new Map<string, { rev: number; updatedAt: number; data: unknown }>();
const users = new Map<string, { authKey: string; slot: string; recovery: string; kind: 'birthday' | 'code'; ver: number }>();
const RECOVERY = 'ABCD-EFGH-JKLM-NPQR-STUV';
const RECOVERY2 = 'WXYZ-2345-6789-ABCD-EFGH';

function token(email: string): string {
  const u = users.get(email)!;
  return `v1.${Buffer.from(JSON.stringify({ email, ver: u.ver })).toString('base64url')}.sig`;
}

async function mockWorker(context: BrowserContext): Promise<void> {
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

async function openAuth(page: Page, mode: 'Create account' | 'Sign in'): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('account-card').getByRole('button', { name: mode }).click();
}

test('sign up on one device, sign in on another, reset the password with the birthday', async ({ browser }) => {
  kv.clear();
  users.clear();
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const errors: string[] = [];
  a.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto('/');
  await wipeState(a);
  await mockWorker(ctxA); // after wipeState: the last-registered route wins over the helper's stub
  await completeOnboarding(a, 'Ravi');
  await a.getByRole('button', { name: /lesson 1/i }).first().click();
  await completeLesson(a);
  await a.getByRole('button', { name: 'Continue' }).click();

  await test.step('device A creates an account with a birthday; there is no code to save', async () => {
    await openAuth(a, 'Create account');
    await a.getByLabel('Email').fill('ravi@example.com');
    await a.getByLabel('Password').fill('parrot-power-9');
    await a.getByRole('button', { name: 'Create account' }).click();
    await expect(a.getByRole('alert')).toContainText('date of birth');
    await a.getByLabel('Birthday').fill('2010-05-14');
    await a.getByRole('button', { name: 'Create account' }).click();
    await expect(a.getByTestId('account-card')).toContainText('ravi@example.com', { timeout: 20_000 });
    await expect(a.getByTestId('account-card')).toContainText('Your birthday resets it');
    await expect(a.getByTestId('recovery-code')).toHaveCount(0);
    expect(errors.filter((e) => e.includes('auth failed'))).toEqual([]);
    // the account adopted the device's slot and the progress is in the cloud
    await expect.poll(() => kv.size, { timeout: 15_000 }).toBeGreaterThan(0);
  });

  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await b.goto('/');
  await wipeState(b);
  await mockWorker(ctxB);
  await completeOnboarding(b, 'Ravi');

  await test.step('device B signs in and receives the streak and lesson', async () => {
    await openAuth(b, 'Sign in');
    await b.getByLabel('Email').fill('Ravi@Example.com');
    await b.getByLabel('Password').fill('parrot-power-9');
    await b.getByRole('button', { name: 'Sign in' }).click();
    await expect(b.getByTestId('account-card')).toContainText('ravi@example.com', { timeout: 20_000 });
    await b.getByRole('button', { name: 'Home' }).click();
    await expect(b.getByLabel(/Streak: 1 days/)).toBeVisible({ timeout: 15_000 });
    await expect(b.getByRole('button', { name: /lesson 1/i }).first()).toContainText('✓');
  });

  await test.step('device B stays signed in across a relaunch', async () => {
    // the first sync after sign-in replaces local state with the merged
    // account data; the session row must survive that
    await expect.poll(() => kv.size, { timeout: 15_000 }).toBeGreaterThan(0);
    await b.reload();
    await b.getByRole('button', { name: 'Settings' }).click();
    await expect(b.getByTestId('account-card')).toContainText('ravi@example.com', { timeout: 20_000 });
  });

  await test.step('a wrong password is rejected; a wrong birthday too; the right birthday resets it', async () => {
    await b.getByRole('button', { name: 'Settings' }).click();
    await b.getByRole('button', { name: 'Sign out', exact: true }).click();
    await openAuth(b, 'Sign in');
    await b.getByLabel('Email').fill('ravi@example.com');
    await b.getByLabel('Password').fill('wrong-password');
    await b.getByRole('button', { name: 'Sign in' }).click();
    await expect(b.getByRole('alert')).toContainText('wrong', { timeout: 20_000 });
    await b.getByRole('button', { name: /Reset it with your birthday/i }).click();
    await b.getByLabel('Birthday').fill('2010-05-15');
    await b.getByLabel('New password').fill('new-parrot-10');
    await b.getByRole('button', { name: 'Reset password' }).click();
    await expect(b.getByRole('alert')).toContainText('wrong', { timeout: 20_000 });
    await b.getByLabel('Birthday').fill('2010-05-14');
    await b.getByRole('button', { name: 'Reset password' }).click();
    await expect(b.getByTestId('account-card')).toContainText('ravi@example.com', { timeout: 20_000 });
    expect(users.get('ravi@example.com')!.ver).toBe(2);
  });

  await test.step('an account from before birthdays resets with its code, then adds a birthday in Settings', async () => {
    users.set('old@example.com', { authKey: 'x', slot: 'ef'.repeat(28), recovery: RECOVERY, kind: 'code', ver: 1 });
    await b.getByRole('button', { name: 'Sign out', exact: true }).click();
    await openAuth(b, 'Sign in');
    await b.getByRole('button', { name: /Reset it with your birthday/i }).click();
    await b.getByRole('button', { name: /Use your recovery code/i }).click();
    await b.getByLabel('Email').fill('old@example.com');
    await b.getByLabel('Recovery code').fill(RECOVERY.toLowerCase());
    await b.getByLabel('New password').fill('old-parrot-11');
    await b.getByRole('button', { name: 'Reset password' }).click();
    await expect(b.getByTestId('recovery-code')).toHaveText(RECOVERY2, { timeout: 20_000 });
    await b.getByText('I saved this code').click();
    await b.getByRole('button', { name: 'Done' }).click();
    await b.getByTestId('add-birthday').getByLabel(/Add your birthday/).fill('1975-12-01');
    await b.getByRole('button', { name: 'Save birthday' }).click();
    await expect(b.getByTestId('account-card')).toContainText('Your birthday resets it');
    expect(users.get('old@example.com')).toMatchObject({ kind: 'birthday', recovery: '1975-12-01' });
  });

  await ctxA.close();
  await ctxB.close();
});
