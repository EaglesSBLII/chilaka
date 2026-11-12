// The Reading & Writing pathway: switch tracks, learn letters, WRITE Telugu.
import { expect, test } from '@playwright/test';
import { completeLesson, completeOnboarding, wipeState } from './helpers';

test('script pathway: keyboard guide, script-only display, writing exercises', async ({ page }) => {
  await wipeState(page);
  await completeOnboarding(page, 'Ravi');

  // switch to the Read & Write pathway
  await page.getByRole('button', { name: /Read & Write/ }).click();
  await expect(page.getByText('Need the Telugu keyboard?')).toBeVisible();
  await expect(page.getByText(/అక్షరాలు/).first()).toBeVisible();

  // first letters lesson
  await page.getByRole('button', { name: /First vowels lesson 1/i }).click();

  // walk the lesson; verify immersion + writing exercises appear
  let sawTypeScript = false;
  let sawReveal = false;
  for (let i = 0; i < 40; i++) {
    await Promise.race([
      page.getByTestId('exercise').waitFor({ state: 'visible', timeout: 20_000 }),
      page.getByText('Lesson complete!').waitFor({ state: 'visible', timeout: 20_000 }),
    ]).catch(() => {});
    if (await page.getByText('Lesson complete!').isVisible().catch(() => false)) break;
    const kind = await page
      .getByTestId('exercise')
      .getAttribute('data-kind', { timeout: 5_000 })
      .catch(() => null);
    if (kind === null) continue; // exercise swapped out mid-read — re-race
    if (kind === 'type-script') {
      sawTypeScript = true;
      // the lesson can finish between reading the kind and this check (short letter lessons)
      await expect(page.getByText('Write it in Telugu').or(page.getByText('Lesson complete!'))).toBeVisible();
    }
    if (!sawReveal && (await page.getByText('👁 Show English').isVisible().catch(() => false))) {
      sawReveal = true; // English hidden behind reveal — immersion works
    }
    const { solveCurrentExercise } = await import('./helpers');
    if ((await solveCurrentExercise(page)) === 'done') break;
  }
  await expect(page.getByText('Lesson complete!')).toBeVisible();
  expect(sawTypeScript).toBe(true); // writing practice happened
  expect(sawReveal).toBe(true); // English was hidden until asked

  await page.getByRole('button', { name: 'Continue' }).click();
  // progress recorded on the script path
  await page.getByRole('button', { name: /Read & Write/ }).click();
  await expect(page.getByRole('button', { name: /First vowels lesson 1/i })).toContainText('✓');
});
