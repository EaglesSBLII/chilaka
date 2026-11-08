// Captures key screens for visual review. Not a pass/fail gate.
import { test } from '@playwright/test';
import { completeLesson, completeOnboarding, solveCurrentExercise, wipeState } from './helpers';

import { mkdirSync } from 'node:fs';

const SHOTS = '/private/tmp/claude-502/-Users-Arnav/fea16b72-30ca-4e52-b84b-d61d4aee7ada/scratchpad/shots';
mkdirSync(SHOTS, { recursive: true });

test('capture screens', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await wipeState(page);
  await page.screenshot({ path: `${SHOTS}/01-onboarding.png` });
  await completeOnboarding(page);
  await page.screenshot({ path: `${SHOTS}/02-path.png` });
  await page.getByRole('button', { name: /lesson 1/i }).first().click();
  // capture a few different exercise screens
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/03-exercise-${i}.png` });
    await solveCurrentExercise(page);
  }
  await completeLesson(page);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/03-complete.png` });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Quests', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/06-quests.png` });
  await page.getByRole('button', { name: /Coins: \d+/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/07-shop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'See all badges' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/08-badges.png`, fullPage: true });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('account-card').getByRole('button', { name: 'Create account' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/09-auth.png` });
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/04-profile.png` });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/05-settings.png` });
});
