// The games as a real player meets them: wrong answers, a memory board
// explored card by card, a Pair Pop clock that runs out, and more rounds than
// the day's full-pay allowance. Every finished round must reach the
// completion screen and add coins to the balance.
import { expect, test, type Page } from '@playwright/test';
import { completeLesson, completeOnboarding, playFeedRound, playMemoryRound, wipeState } from './helpers';

const summary = (page: Page) => page.getByTestId('game-summary');

/** Wait for the saved completion screen; returns the coins it paid and the balance it shows. */
async function finished(page: Page): Promise<{ coins: number; balance: number }> {
  await expect(summary(page)).toBeVisible({ timeout: 20_000 });
  await expect(summary(page)).toHaveAttribute('data-saved', 'true');
  await expect(page.getByRole('heading', { name: /round/i })).toBeVisible();
  const coins = Number(await summary(page).getAttribute('data-coins'));
  const balance = Number((await page.getByTestId('game-balance').textContent())?.replace(/\D/g, ''));
  return { coins, balance };
}

async function hubBalance(page: Page): Promise<number> {
  await expect(page.getByTestId('play-hub')).toBeVisible();
  return Number((await page.getByTestId('coin-balance').textContent())?.replace(/\D/g, '') ?? '0');
}

test('every finished round shows the completion screen and pays coins', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await wipeState(page);
  await completeOnboarding(page, 'Ravi');
  await page.getByRole('button', { name: /lesson 1/i }).first().click();
  await completeLesson(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  let balance = await hubBalance(page);

  await test.step('Memory Flip explored the way a child plays it', async () => {
    await page.getByRole('button', { name: 'Play Memory Flip' }).click();
    const board = page.getByTestId('game-memory');
    await expect(board).toBeVisible();
    // turn the cards over two at a time in board order: mostly mismatches
    const keys = await board.locator('button[data-card-key]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-key')!));
    for (let i = 0; i + 1 < keys.length; i += 2) {
      for (const k of [keys[i], keys[i + 1]]) {
        const card = board.locator(`button[data-card-key="${k}"]`);
        if ((await card.getAttribute('data-up')) === 'false') await card.click();
      }
      // a mismatch turns back after its pause
      await expect.poll(async () => board.locator('button[data-up="true"]:not([disabled])').count(), { timeout: 5000 }).toBe(0);
    }
    // now finish from memory
    const left = await board.locator('button[data-face="te"]:not([disabled])').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')!));
    for (const id of left) {
      const found = await board.getAttribute('data-found');
      await board.locator(`button[data-item-id="${id}"][data-face="te"]`).click();
      await board.locator(`button[data-item-id="${id}"][data-face="gloss"]`).click();
      await expect.poll(async () => (await summary(page).isVisible()) || (await board.getAttribute('data-found').catch(() => null)) !== found).toBe(true);
    }
    const r = await finished(page);
    // exploring unseen cards is not a mistake: this was a clean round
    await expect(page.getByLabel('3 of 3 stars')).toBeVisible();
    expect(r.coins).toBeGreaterThanOrEqual(5);
    expect(r.balance).toBe(balance + r.coins);
    await page.getByRole('button', { name: 'Done' }).click();
    expect(await hubBalance(page)).toBe(balance + r.coins);
    balance += r.coins;
  });

  await test.step('Feed Chikki with a wrong fruit on every prompt still pays for finishing', async () => {
    await page.getByRole('button', { name: 'Play Feed Chikki' }).click();
    const board = page.getByTestId('game-feed');
    await expect(board).toBeVisible();
    for (let i = 0; i < 12; i++) {
      if (await summary(page).isVisible().catch(() => false)) break;
      const step = await board.getAttribute('data-step');
      const id = await board.getAttribute('data-prompt-item');
      await board.locator(`button[data-item-id]:not([data-item-id="${id}"])`).first().click();
      await board.locator(`button[data-item-id="${id}"]:not([disabled])`).click();
      await expect
        .poll(async () => (await summary(page).isVisible().catch(() => false)) || (await board.getAttribute('data-step').catch(() => null)) !== step, { timeout: 10_000 })
        .toBe(true);
    }
    const r = await finished(page);
    await expect(page.getByLabel('1 of 3 stars')).toBeVisible();
    await expect(page.getByText("Chikki's favourites")).toBeVisible();
    expect(r.coins).toBe(5);
    expect(r.balance).toBe(balance + 5);
    await page.getByRole('button', { name: 'Done' }).click();
    balance += r.coins;
  });

  await test.step('Pair Pop when the clock runs out', async () => {
    await page.clock.install();
    await page.getByRole('button', { name: 'Play Pair Pop' }).click();
    const board = page.getByTestId('game-pairs');
    await board.locator('button[data-side="te"]').first().waitFor();
    const id = await board.locator('button[data-side="te"]').first().getAttribute('data-item-id');
    await board.locator('button[data-side="te"]').first().click();
    await board.locator(`button[data-side="gloss"][data-item-id="${id}"]`).click();
    await page.clock.runFor(1000);
    await expect(board).toHaveAttribute('data-matched', '1');
    await page.clock.runFor(95_000);
    const r = await finished(page);
    expect(r.coins).toBeGreaterThanOrEqual(5);
    expect(r.balance).toBe(balance + r.coins);
    await page.clock.resume();
    await page.getByRole('button', { name: 'Done' }).click();
    balance += r.coins;
  });

  await test.step('rounds beyond the daily allowance still pay a treat', async () => {
    // rounds 4 and 5 pay in full, round 6 pays the small treat
    for (const round of [4, 5, 6]) {
      await page.getByRole('button', { name: round % 2 ? 'Play Memory Flip' : 'Play Feed Chikki' }).click();
      if (round % 2) await playMemoryRound(page);
      else await playFeedRound(page);
      const r = await finished(page);
      if (round === 6) {
        expect(r.coins).toBe(2);
        await expect(page.getByText(/small treat/)).toBeVisible();
      } else expect(r.coins).toBeGreaterThan(5);
      expect(r.balance).toBe(balance + r.coins);
      balance += r.coins;
      await page.getByRole('button', { name: 'Done' }).click();
      expect(await hubBalance(page)).toBe(balance);
    }
  });

  await test.step('the coins are still there after a reload', async () => {
    await page.reload();
    await page.getByRole('button', { name: 'Play' }).click();
    expect(await hubBalance(page)).toBe(balance);
  });

  expect(errors).toEqual([]);
});
