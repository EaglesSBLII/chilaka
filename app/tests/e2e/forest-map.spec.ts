// The forest map (features/forest): default path style, Chikki's perch and
// flight, reduced motion, both tracks, and the Settings switch back to the
// classic path.
import { expect, test } from '@playwright/test';
import { completeLesson, completeOnboarding, wipeState } from './helpers';

test('forest map: Chikki sits on the current lesson and flies on after a lesson', async ({ page }) => {
  await wipeState(page);
  await completeOnboarding(page, 'Ravi');

  const map = page.getByTestId('forest-map');
  await expect(map).toBeVisible();
  const lesson1 = page.getByRole('button', { name: /lesson 1/i }).first();
  const lesson2 = page.getByRole('button', { name: /lesson 2/i }).first();
  const perch1 = await lesson1.getAttribute('data-perch');
  const perch2 = await lesson2.getAttribute('data-perch');
  expect(perch1).toBeTruthy();

  // first load: no flight, Chikki perched on lesson 1, which is on screen
  await expect(map).toHaveAttribute('data-chikki-at', perch1!);
  await expect(map).toHaveAttribute('data-flight', 'none');
  await expect(lesson1).toHaveAttribute('data-state', 'current');
  await expect(lesson1).toBeInViewport();
  await expect(lesson2).toBeDisabled();
  await expect(map.locator('.f-perched')).toHaveCount(1);

  // finish lesson 1: back on the path Chikki flies from perch 1 to perch 2
  await lesson1.click();
  await completeLesson(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(map).toHaveAttribute('data-flight', 'fly', { timeout: 5_000 });
  await expect(map.locator('.f-flyer')).toHaveCount(1);
  await expect(map).toHaveAttribute('data-flight', 'none', { timeout: 6_000 });
  await expect(map).toHaveAttribute('data-chikki-at', perch2!);
  await expect(map.locator('.f-flyer')).toHaveCount(0);
  await expect(lesson1).toContainText('✓');
  await expect(lesson2).toHaveAttribute('data-state', 'current');
  await expect(lesson2).toBeInViewport();

  // reduced motion: no flight, Chikki is simply on the next perch
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const lesson3 = page.getByRole('button', { name: /lesson 3/i }).first();
  const perch3 = await lesson3.getAttribute('data-perch');
  await lesson2.click();
  await completeLesson(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(map).toHaveAttribute('data-chikki-at', perch3!);
  await expect(map).toHaveAttribute('data-flight', 'none');
  await page.waitForTimeout(700); // longer than the pre-flight pause
  await expect(map.locator('.f-flyer')).toHaveCount(0);
  await expect(map).toHaveAttribute('data-chikki-at', perch3!);
});

test('forest map: Read & Write track, and Settings switches to the classic path and back', async ({ page }) => {
  await wipeState(page);
  await completeOnboarding(page, 'Ravi');
  const map = page.getByTestId('forest-map');
  await expect(map).toHaveAttribute('data-track', 'speak');

  // the other track is a forest too, with its own current perch
  await page.getByRole('button', { name: /Read & Write/ }).click();
  await expect(map).toHaveAttribute('data-track', 'script');
  await expect(page.getByText('Need the Telugu keyboard?')).toBeVisible();
  const vowels1 = page.getByRole('button', { name: /First vowels lesson 1/i });
  await expect(vowels1).toHaveAttribute('data-state', 'current');
  await expect(map).toHaveAttribute('data-chikki-at', (await vowels1.getAttribute('data-perch'))!);
  await expect(page.getByText('Section 1', { exact: true })).toBeVisible();

  // Settings → Path style → Classic
  await page.getByRole('button', { name: 'Settings' }).click();
  const card = page.getByTestId('path-style-setting');
  await expect(card.getByRole('button', { name: 'Forest map' })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Classic' }).click();
  await expect(card.getByRole('button', { name: 'Classic' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Learn' }).click();
  // the path remembers the track (still Read & Write), in either style
  await expect(page.getByText('Need the Telugu keyboard?')).toBeVisible();
  await expect(page.getByTestId('forest-map')).toHaveCount(0);
  await expect(page.locator('.f-backdrop')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /lesson 1/i }).first()).toBeEnabled();

  // the choice is remembered on this device
  await page.reload();
  // the path remembers the track (still Read & Write), in either style
  await expect(page.getByText('Need the Telugu keyboard?')).toBeVisible();
  await expect(page.getByTestId('forest-map')).toHaveCount(0);

  // and back again
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('path-style-setting').getByRole('button', { name: 'Forest map' }).click();
  await page.getByRole('button', { name: 'Learn' }).click();
  await expect(page.getByTestId('forest-map')).toBeVisible();
  await expect(page.locator('.f-backdrop')).toHaveCount(1);
});
