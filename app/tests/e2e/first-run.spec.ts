// First open: the welcome animation, then "sign in or create an account".
// A new account is asked its name and level; signing in to an existing one
// asks nothing, because the account already has them.
import { expect, test } from '@playwright/test';
import { wipeState } from './helpers';
import { kv, mockWorker, users } from './mock-worker';

test('welcome animation, then account first: create asks the questions, sign-in does not', async ({ browser }) => {
  kv.clear();
  users.clear();
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await a.goto('/');
  await wipeState(a);
  await mockWorker(ctxA);

  await test.step('first open shows the welcome once, and it ends by itself', async () => {
    await a.evaluate(() => localStorage.removeItem('chilaka.welcomed'));
    await a.reload();
    const welcome = a.getByTestId('welcome');
    await expect(welcome).toBeVisible();
    await expect(welcome).toContainText('Welcome to Chilaka');
    await expect(welcome).toHaveCount(0, { timeout: 8_000 });
    await expect(a.getByRole('button', { name: 'Create an account' })).toBeVisible();
    await a.reload();
    await expect(a.getByRole('button', { name: 'Create an account' })).toBeVisible();
    await expect(a.getByTestId('welcome')).toHaveCount(0);
  });

  await test.step('a tap skips the welcome', async () => {
    await a.evaluate(() => localStorage.removeItem('chilaka.welcomed'));
    await a.reload();
    await a.getByTestId('welcome').click();
    await expect(a.getByTestId('welcome')).toHaveCount(0, { timeout: 1_500 });
  });

  await test.step('creating an account leads to the name and level questions', async () => {
    await a.getByRole('button', { name: 'Create an account' }).click();
    await a.getByLabel('Email').fill('meena@example.com');
    await a.getByLabel('Password').fill('parrot-power-9');
    await a.getByLabel('Birthday').fill('2011-03-02');
    await a.getByRole('button', { name: 'Create account' }).click();
    await expect(a.getByText('What should I call you?')).toBeVisible({ timeout: 20_000 });
    await a.getByPlaceholder('Your name').fill('Meena');
    await a.getByRole('button', { name: 'Continue' }).click();
    await a.getByRole('button', { name: 'Continue' }).click();
    await a.getByRole('button', { name: 'Start from the beginning' }).click();
    await expect(a.getByText('Meena', { exact: false }).first()).toBeVisible();
    // the profile reaches the account
    await expect.poll(() => JSON.stringify([...kv.values()]).includes('Meena'), { timeout: 20_000 }).toBe(true);
  });

  await test.step('a second device signs in and is asked nothing', async () => {
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await b.goto('/');
    await wipeState(b);
    await mockWorker(ctxB);
    await b.getByRole('button', { name: 'I already have an account' }).click();
    await b.getByLabel('Email').fill('meena@example.com');
    await b.getByLabel('Password').fill('parrot-power-9');
    await b.getByRole('button', { name: 'Sign in' }).click();
    await expect(b.getByText('Meena', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(b.getByText('What should I call you?')).toHaveCount(0);
    await expect(b.getByRole('button', { name: /lesson 1/i }).first()).toBeVisible();
    await ctxB.close();
  });

  await test.step('back from the account form, and the no-account path still works', async () => {
    const ctxC = await browser.newContext();
    const c = await ctxC.newPage();
    await c.goto('/');
    await wipeState(c);
    await c.getByRole('button', { name: 'Create an account' }).click();
    await c.getByRole('button', { name: 'Back' }).click();
    await c.getByRole('button', { name: 'Continue without an account' }).click();
    await expect(c.getByText('What should I call you?')).toBeVisible();
    await ctxC.close();
  });
  await ctxA.close();
});
