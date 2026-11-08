// Gamification: coins after a lesson, quest progress, the shop, badges.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { completeLesson, completeOnboarding, wipeState } from './helpers';
import { fnv1a } from '../../src/db/backup';

test('a lesson pays coins, moves a quest, and the shop sells a freeze', async ({ page }) => {
  await test.step('onboard and finish the first lesson', async () => {
    await wipeState(page);
    await completeOnboarding(page, 'Ravi');
    await expect(page.getByTestId('coin-balance')).toHaveText('0');
    await page.getByRole('button', { name: /lesson 1/i }).first().click();
    await completeLesson(page);
  });

  await test.step('the summary shows coins and the balance grows', async () => {
    await expect(page.getByTestId('coins-earned')).toBeVisible();
    // 10 for the lesson (+15 if perfect, +20 if the goal was reached)
    await expect(page.getByTestId('coins-earned')).toContainText(/\+(10|25|30|45)/, { timeout: 5_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    const balance = Number(await page.getByTestId('coin-balance').textContent());
    expect(balance).toBeGreaterThanOrEqual(10);
  });

  await test.step('quests track the lesson', async () => {
    await page.getByRole('button', { name: 'Quests', exact: true }).click();
    await expect(page.getByText("Today's quests")).toBeVisible();
    await expect(page.getByTestId('quest-progress')).toHaveCount(2);
    const texts = await page.getByTestId('quest-progress').allTextContents();
    expect(texts.some((t) => !t.startsWith('0/'))).toBe(true);
  });

  await test.step('coins persist across reload and badges list the first one', async () => {
    await page.reload();
    const balance = Number(await page.getByTestId('coin-balance').textContent());
    expect(balance).toBeGreaterThanOrEqual(10);
    await page.getByRole('button', { name: 'Profile' }).click();
    await page.getByRole('button', { name: 'See all badges' }).click();
    await expect(page.getByTestId('badge-first-steps')).toContainText('Bronze');
  });

  await test.step('the shop sells a streak freeze once there are enough coins', async () => {
    // seed a balance through the backup round trip (the same import path sync uses)
    await page.getByRole('button', { name: 'Settings' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup' }).click();
    const download = await downloadPromise;
    const path = (await download.path())!;
    const backup = JSON.parse(readFileSync(path, 'utf8')) as { data: { coinEvents: unknown[] }; checksum: string };
    backup.data.coinEvents.push({ ts: '2026-01-01T00:00:00.000Z', day: '2026-01-01', delta: 500, kind: 'quest', refId: 'seed' });
    backup.checksum = fnv1a(JSON.stringify(backup.data));
    const seeded = join(tmpdir(), `chilaka-seed-${Date.now()}.json`);
    writeFileSync(seeded, JSON.stringify(backup));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import backup' }).click()]);
    await chooser.setFiles(seeded);
    await expect(page.getByText('Backup restored!')).toBeVisible();
    await page.getByRole('button', { name: /Coins: \d+/ }).click();
    await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
    const before = Number(await page.getByTestId('shop-balance').textContent());
    expect(before).toBeGreaterThanOrEqual(500);
    await page.getByRole('button', { name: /\b200\b/ }).first().click();
    await expect(page.getByTestId('shop-balance')).toHaveText(String(before - 200));
    await expect(page.getByText('Holding 1/2')).toBeVisible();
  });
});
