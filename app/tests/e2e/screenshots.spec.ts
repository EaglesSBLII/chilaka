// Captures key screens for visual review. Not a pass/fail gate.
import { test } from '@playwright/test';
import { completeOnboarding, solveCurrentExercise, wipeState } from './helpers';

const SHOTS = '/private/tmp/claude-502/-Users-Arnav-Downloads-Claude-Code-test/104aea3c-4a4e-4a4d-96dc-bb96bff35555/scratchpad/shots';

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
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/04-profile.png` });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/05-settings.png` });
});
