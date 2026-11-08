// The main product journey in one continuous session (IndexedDB state is
// per-context, so the steps share one page): onboard → lesson → XP/streak →
// reload persistence → review → backup round-trip.

import { expect, test } from '@playwright/test';
import { completeLesson, completeOnboarding, wipeState } from './helpers';

test('full learner journey: onboard, learn, persist, review, backup', async ({ page }) => {
  await test.step('onboarding creates a profile and lands on the path', async () => {
    await wipeState(page);
    await completeOnboarding(page, 'Ravi');
    await expect(page.getByText('Basic speech')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Basic speech')).toBeVisible();
    await expect(page.getByText("Let's go!")).toHaveCount(0);
  });

  await test.step('completing a lesson awards XP and starts the streak', async () => {
    await page.getByRole('button', { name: /lesson 1/i }).first().click();
    await completeLesson(page);
    await expect(page.getByText(/1-day streak started!/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel(/Streak: 1 days/)).toBeVisible();
  });

  await test.step('progress persists across reload', async () => {
    await page.reload();
    await expect(page.getByLabel(/Streak: 1 days/)).toBeVisible();
    await expect(page.getByRole('button', { name: /lesson 1/i }).first()).toContainText('✓');
  });

  await test.step('review deck has cards and the review flow works', async () => {
    await page.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByText(/^1 \/ \d+/)).toBeVisible();
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();
    await expect(page.getByText(/Reviewed \d+ cards!|2 \/ \d+/).first()).toBeVisible();
  });

  let backupPath: string;
  await test.step('backup exports a file', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup' }).click();
    const download = await downloadPromise;
    backupPath = (await download.path())!;
    expect(backupPath).toBeTruthy();
  });

  await test.step('wipe then import restores everything', async () => {
    await wipeState(page);
    await expect(page.getByText("Let's go!")).toBeVisible();
    await completeOnboarding(page, 'Temp');
    await page.getByRole('button', { name: 'Settings' }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Import backup' }).click(),
    ]);
    await chooser.setFiles(backupPath);
    await expect(page.getByText('Backup restored!')).toBeVisible();
    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.getByText('Ravi')).toBeVisible();
    await expect(page.getByLabel(/Streak: 1 days/)).toBeVisible();
  });
});

test('placement test routes an all-correct learner past section 1', async ({ page }) => {
  await wipeState(page);
  await page.getByRole('button', { name: "Let's go!" }).click();
  await page.getByPlaceholder('Your name').fill('Padma');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Find my level' }).click();

  for (let i = 0; i < 18; i++) {
    if (await page.getByRole('button', { name: 'Start learning' }).isVisible().catch(() => false)) break;
    const prompt = page.locator('[class*="text-2xl"]').first();
    await expect(prompt).toBeVisible();
    const roman = (await prompt.textContent())!.trim();
    const gloss = await page.evaluate(
      (r) => (window as unknown as { __glossForRoman(r: string): string | null }).__glossForRoman(r),
      roman,
    );
    if (!gloss) throw new Error(`no gloss for prompt: ${roman}`);
    await page.getByRole('button', { name: gloss, exact: true }).click();
    await page.waitForTimeout(800);
  }
  await page.getByRole('button', { name: 'Start learning' }).click();
  await expect(page.getByText(/Section [2-8]/).first()).toBeVisible();
});
