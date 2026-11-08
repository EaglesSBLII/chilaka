// Web update flow: a changed service worker installs in the background, the
// banner shows precache progress as a percentage, and nothing switches over
// until the learner presses Restart. The "new version" is the same build with
// a byte changed in sw.js, which is exactly how the browser detects a release.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ trace: 'off' }); // tracing starves the precache (see mobile-pwa.spec)

const SW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'sw.js');

test('update banner: progress, then a manual Restart', async ({ page }) => {
  const original = readFileSync(SW, 'utf8');
  try {
    await page.goto('/');
    // first install: silent (no banner), wait for the worker to take control
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 60_000 }).toBe(true);
    await expect(page.getByTestId('update-banner')).toHaveCount(0);

    // publish a "new version"
    writeFileSync(SW, `${original}\n// release ${Date.now()}\n`);
    const percents: number[] = [];
    await page.exposeFunction('__pct', (n: number) => percents.push(n));
    await page.evaluate(() => {
      new MutationObserver(() => {
        const t = document.querySelector('[data-testid=update-percent]')?.textContent;
        if (t) (window as unknown as { __pct: (n: number) => void }).__pct(Number(t.replace('%', '')));
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
      void navigator.serviceWorker.getRegistration().then((r) => r?.update());
    });

    const banner = page.getByTestId('update-banner');
    await expect(banner).toHaveAttribute('data-phase', 'ready', { timeout: 90_000 });
    await expect(banner).toContainText('A new version of Chilaka is ready');
    const restart = banner.getByRole('button', { name: 'Restart' });
    await expect(restart).toBeVisible();
    // progress was reported while the new worker installed, and only ever went up
    expect(percents.length).toBeGreaterThan(0);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    // still the old worker until the learner says so
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    await page.screenshot({ path: 'test-results/pwa-update-ready.png' });

    await restart.click();
    await page.waitForLoadState('load');
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting)), { timeout: 30_000 }).toBe(false);
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
  } finally {
    writeFileSync(SW, original);
  }
});
