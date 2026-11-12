// Web speaking on the first lesson, graded by ear: Chromium's fake microphone
// plays our MALE native clip of నమస్కారం while the app's reference voice is the
// default female one, so a pass means the acoustic match recognised the same
// word from a different speaker — the situation a real learner is in.
import { expect, test } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeOnboarding, solveCurrentExercise, wipeState } from './helpers';

const take = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'take-male-u65-i01.wav');

test.use({
  // the headless shell has no audio pipeline; the full browser in new-headless mode does
  channel: 'chromium',
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${take}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  permissions: ['microphone'],
});

test('a native take of the first word passes the web speaking exercise by ear', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'fake audio capture is a Chromium flag');
  await wipeState(page);
  await completeOnboarding(page, 'Ravi');
  await page.getByRole('button', { name: /lesson 1/i }).first().click();

  // every new phrase goes card → SPEAK → pick by ear; stop at the first speak
  for (let i = 0; i < 6; i++) {
    const ex = page.getByTestId('exercise');
    await ex.waitFor({ state: 'visible', timeout: 20_000 });
    if ((await ex.getAttribute('data-kind')) === 'speak') break;
    await solveCurrentExercise(page);
  }
  const ex = page.getByTestId('exercise');
  await expect(ex).toHaveAttribute('data-kind', 'speak');
  await expect(ex).toHaveAttribute('data-item-id', 'u65-i01');

  // the fake device starts the file when the stream opens: tap, let the word play, tap
  await page.getByRole('button', { name: /Tap to record/ }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /tap to stop/ }).click();

  const verdict = page.getByTestId('ear-result');
  await expect(verdict).toBeVisible({ timeout: 20_000 });
  await expect(verdict).toHaveAttribute('data-pass', 'true');
  await expect(page.getByText(/sounds right|Close!/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
});
