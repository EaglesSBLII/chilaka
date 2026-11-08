// Captures the Play tab and each game on a phone viewport for visual review.
// Not a pass/fail gate.
import { devices, test } from '@playwright/test';
import { completeLesson, completeOnboarding, playFeedRound, wipeState } from './helpers';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.CHILAKA_SHOTS ?? '/tmp/chilaka-shots';
mkdirSync(SHOTS, { recursive: true });

test.use({ ...devices['iPhone 13'] });

test('capture game screens', async ({ page }) => {
  await wipeState(page);
  await completeOnboarding(page, 'Meena');
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/g-00-play-locked.png` });
  await page.getByRole('button', { name: 'Go to lessons' }).click();
  await page.getByRole('button', { name: /lesson 1/i }).first().click();
  await completeLesson(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/g-01-play-hub.png` });

  await page.getByRole('button', { name: 'Play Feed Chikki' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/g-02-feed.png` });
  // one wrong tap to show the shake/dim state
  const board = page.getByTestId('game-feed');
  const answer = await board.getAttribute('data-prompt-item');
  const wrong = board.locator(`button[data-item-id]:not([data-item-id="${answer}"])`).first();
  await wrong.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/g-03-feed-wrong.png` });
  await playFeedRound(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/g-04-summary.png`, fullPage: true });
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Play Pair Pop' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/g-05-pairs.png` });
  const left = page.locator('button[data-side="te"]').first();
  await left.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/g-06-pairs-selected.png` });
  await page.getByRole('button', { name: 'Quit game' }).click();

  await page.getByRole('button', { name: 'Play Memory Flip' }).click();
  await page.waitForTimeout(600);
  await page.locator('button[data-face="te"]').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/g-07-memory.png` });
});
