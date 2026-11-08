// Chikki's games: the Play tab is locked until a lesson is done, then each of
// the three games can be played to a summary that pays XP and coins, feeds
// the quest and reschedules the phrases it used. Rounds are solved from the
// data attributes the games expose, so the shuffles never matter.
import { expect, test } from '@playwright/test';
import { completeLesson, completeOnboarding, playFeedRound, playMemoryRound, playPairsRound, wipeState } from './helpers';

test('games unlock after a lesson and every game pays out', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await wipeState(page);
  await completeOnboarding(page, 'Ravi');

  await test.step('Play is locked before any lesson', async () => {
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByTestId('play-hub')).toHaveAttribute('data-learned', '0');
    await expect(page.getByText('Finish your first lesson')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(0);
    await expect(page.getByText(/Learn \d+ more/).first()).toBeVisible();
  });

  await test.step('a lesson opens the games', async () => {
    await page.getByRole('button', { name: 'Go to lessons' }).click();
    await page.getByRole('button', { name: /lesson 1/i }).first().click();
    await completeLesson(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByTestId('play-hub')).toHaveAttribute('data-learned', '4');
    await expect(page.getByRole('button', { name: 'Play Feed Chikki' })).toBeVisible();
  });

  const xpOf = async () => Number((await page.locator('header').textContent())?.match(/(\d+)\s*\/\s*\d+ XP/)?.[1] ?? '0');
  const coinsOf = async () => Number((await page.getByTestId('coin-balance').textContent())?.replace(/\D/g, '') ?? '0');

  await test.step('Feed Chikki: a perfect round earns XP, coins and three stars', async () => {
    const xp0 = await xpOf();
    const coins0 = await coinsOf();
    await page.getByRole('button', { name: 'Play Feed Chikki' }).click();
    await expect(page.getByTestId('game-feed')).toBeVisible();
    await playFeedRound(page);
    await expect(page.getByTestId('game-summary')).toBeVisible();
    await expect(page.getByLabel('3 of 3 stars')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('play-hub')).toBeVisible();
    expect(await xpOf()).toBeGreaterThan(xp0);
    expect(await coinsOf()).toBeGreaterThan(coins0);
  });

  await test.step('Pair Pop: matching every pair ends the round before the clock', async () => {
    await page.getByRole('button', { name: 'Play Pair Pop' }).click();
    await expect(page.getByTestId('game-pairs')).toBeVisible();
    await playPairsRound(page);
    await expect(page.getByTestId('game-summary')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/of \d+ right first time/)).toBeVisible();
    await page.getByRole('button', { name: 'Play again' }).click();
    await expect(page.getByTestId('game-pairs')).toBeVisible();
    await page.getByRole('button', { name: 'Quit game' }).click();
    await expect(page.getByTestId('play-hub')).toBeVisible();
  });

  await test.step('Memory Flip: finding every pair completes the round', async () => {
    await page.getByRole('button', { name: 'Play Memory Flip' }).click();
    await expect(page.getByTestId('game-memory')).toBeVisible();
    await playMemoryRound(page);
    await expect(page.getByTestId('game-summary')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Done' }).click();
  });

  await test.step('rounds count toward the quest and the badge stat, and survive a reload', async () => {
    await page.reload();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByTestId('play-hub')).toHaveAttribute('data-learned', '4');
    await page.getByRole('button', { name: 'Profile' }).click();
    await page.getByRole('button', { name: 'See all badges' }).click();
    await expect(page.getByText('Game master')).toBeVisible();
  });

  expect(errors).toEqual([]);
});
