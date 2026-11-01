// Two-device sync: device A (Mac-ish) learns, device B (fresh iPhone-ish)
// pairs and receives everything; B practices, A receives it back. The sync
// server is an in-memory mock shared by both browser contexts.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { completeLesson, completeOnboarding, wipeState } from './helpers';
import { SYNC_ENDPOINT } from '../../src/sync-config';

const ENDPOINT = 'https://sync.chilaka.test';
const KEY = 'ab'.repeat(28); // 56 hex chars
const CODE = `CHK1-${Buffer.from(JSON.stringify({ e: ENDPOINT, k: KEY }))
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')}`;

// shared in-memory KV — the "cloud"
const kv = new Map<string, { rev: number; updatedAt: number; data: unknown }>();

async function mockSync(context: BrowserContext): Promise<void> {
  // auto-enabled sync targets the real baked endpoint — capture BOTH hosts so
  // tests never touch the live worker (and never race the mock)
  const handler = async (route: import('@playwright/test').Route) => {
    const req = route.request();
    const key = new URL(req.url()).pathname.slice(1);
    const cors = { 'access-control-allow-origin': '*' };
    if (req.method() === 'GET') {
      const cur = kv.get(key);
      if (!cur) return route.fulfill({ status: 404, headers: cors, body: '{}' });
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(cur) });
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() ?? '{}') as { rev: number; data: unknown };
      const curRev = kv.get(key)?.rev ?? 0;
      if (body.rev !== curRev + 1) {
        return route.fulfill({ status: 409, headers: cors, body: JSON.stringify({ conflict: true, rev: curRev }) });
      }
      kv.set(key, { rev: body.rev, updatedAt: 1, data: body.data });
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ rev: body.rev }) });
    }
    return route.fulfill({ status: 405, headers: cors, body: '{}' });
  };
  await context.route(`${ENDPOINT}/**`, handler);
  if (SYNC_ENDPOINT) await context.route(`${SYNC_ENDPOINT}/**`, handler);
}

async function pairViaSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  // auto-sync self-configures new devices — joining now lives behind a button
  const joinToggle = page.getByRole('button', { name: 'Join another device' });
  if (await joinToggle.isVisible().catch(() => false)) await joinToggle.click();
  await page.getByPlaceholder(/paste a pairing code/i).fill(CODE);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.getByText('Paired! Your progress is syncing.')).toBeVisible();
  await expect(page.getByText(/^Synced$/)).toBeVisible({ timeout: 15_000 });
}

async function syncNow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/Syncing…|Synced/).first()).toBeVisible();
  await expect(page.getByText(/^Synced$/)).toBeVisible({ timeout: 15_000 });
}

test('progress made on either device merges to both', async ({ browser }) => {
  kv.clear();

  // ---- device A: learn a lesson, then pair + push ----
  const ctxA = await browser.newContext();
  await mockSync(ctxA);
  const a = await ctxA.newPage();
  await wipeState(a);
  await completeOnboarding(a, 'Ravi');
  await a.getByRole('button', { name: /lesson 1/i }).first().click();
  await completeLesson(a);
  await a.getByRole('button', { name: 'Continue' }).click();
  await pairViaSettings(a);
  expect(kv.get(KEY)?.rev).toBeGreaterThanOrEqual(1);

  // ---- device B: fresh install, pair → receives A's world ----
  const ctxB = await browser.newContext();
  await mockSync(ctxB);
  const b = await ctxB.newPage();
  await wipeState(b);
  await completeOnboarding(b, 'PhoneUser');
  await pairViaSettings(b);

  await b.getByRole('button', { name: 'Home' }).click();
  await expect(b.getByLabel(/Streak: 1 days/)).toBeVisible({ timeout: 10_000 });
  await expect(b.getByRole('button', { name: /lesson 1/i }).first()).toContainText('✓');
  await b.getByRole('button', { name: 'Profile' }).click();
  await expect(b.getByText('Ravi')).toBeVisible(); // original identity survives pairing

  // ---- device B practices: review one card, sync back ----
  await b.getByRole('button', { name: 'Review' }).click();
  await expect(b.getByText(/^1 \/ \d+/)).toBeVisible();
  await b.getByRole('button', { name: 'Show answer' }).click();
  await b.getByRole('button', { name: 'Good', exact: true }).click();
  await syncNow(b);
  const revAfterB = kv.get(KEY)!.rev;

  // ---- device A pulls B's review ----
  const xpBeforeA = await a.evaluate(() => {
    const el = document.querySelector('header');
    return el?.textContent ?? '';
  });
  await syncNow(a);
  await a.getByRole('button', { name: 'Home' }).click();
  const xpAfterA = await a.evaluate(() => document.querySelector('header')?.textContent ?? '');
  expect(kv.get(KEY)!.rev).toBeGreaterThanOrEqual(revAfterB);
  expect(xpAfterA).not.toBe(xpBeforeA); // B's review XP arrived

  await ctxA.close();
  await ctxB.close();
});
