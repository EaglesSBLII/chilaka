import { devices, test } from '@playwright/test';
import { completeOnboarding, solveCurrentExercise, wipeState } from './helpers';

import { mkdirSync } from 'node:fs';

const SHOTS = '/private/tmp/claude-502/-Users-Arnav/fea16b72-30ca-4e52-b84b-d61d4aee7ada/scratchpad/shots';
mkdirSync(SHOTS, { recursive: true });

test.use({ ...devices['iPhone 13'] });

test('capture mobile screens', async ({ page }) => {
  await wipeState(page);
  await completeOnboarding(page, 'Meena');
  await page.screenshot({ path: `${SHOTS}/m-01-path.png` });
  await page.getByRole('button', { name: /lesson 1/i }).first().click();
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(300);
    if (i === 1) await page.screenshot({ path: `${SHOTS}/m-02-exercise.png` });
    if ((await solveCurrentExercise(page)) === 'done') break;
  }
});
