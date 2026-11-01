import { devices, test } from '@playwright/test';
import { completeOnboarding, solveCurrentExercise, wipeState } from './helpers';

const SHOTS = '/private/tmp/claude-502/-Users-Arnav-Downloads-Claude-Code-test/104aea3c-4a4e-4a4d-96dc-bb96bff35555/scratchpad/shots';

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
