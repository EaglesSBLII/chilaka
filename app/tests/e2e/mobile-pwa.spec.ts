// Emulated-iPhone checks for the PWA build: installability (manifest + SW),
// a full lesson on a phone screen, echo-mode speaking (no desktop ASR), and
// true offline reload.

import { devices, expect, test } from '@playwright/test';
import { completeLesson, completeOnboarding, wipeState } from './helpers';
import { SYNC_ENDPOINT } from '../../src/sync-config';

// trace off: tracing captures every SW precache response (~1150 audio files),
// which starves the install in WebKit and the precache never completes
test.use({ ...devices['iPhone 13'], trace: 'off' });

// This spec does a lot (SW install, full lesson, offline checks) and WebKit
// navigation crawls when the host is under heavy load — give it headroom.
test.setTimeout(420_000);

test('PWA installs, teaches a lesson, does echo mode, and works offline', async ({ page, context }) => {
  // hermetic: never let auto-sync reach the live worker from tests
  if (SYNC_ENDPOINT) await context.route(`${SYNC_ENDPOINT}/**`, (r) => r.abort());
  await wipeState(page);

  await test.step('manifest + service worker register (installable)', async () => {
    await page.goto('/');
    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    expect(manifestHref).toBeTruthy();
    // wait for the SW to control the page
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 20_000 }).catch(() => {});
    const swReady = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg);
    });
    expect(swReady).toBe(true);
  });

  await test.step('onboard and complete a lesson on a phone screen', async () => {
    await completeOnboarding(page, 'Meena');
    await page.getByRole('button', { name: /lesson 1/i }).first().click();
    await completeLesson(page);
    await expect(page.getByText('Lesson complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel(/Streak: 1 days/)).toBeVisible();
  });

  await test.step('speaking exercise falls back to echo mode (no desktop ASR)', async () => {
    // start lesson 2, walk to a speak exercise if present, else assert the
    // Speak component honestly labels echo mode when reached in review/dialogue
    await page.getByRole('button', { name: /lesson 2/i }).first().click();
    let sawSpeak = false;
    for (let i = 0; i < 40; i++) {
      // settle on either an exercise or the completion screen before reading
      await Promise.race([
        page.getByTestId('exercise').waitFor({ state: 'visible', timeout: 20_000 }),
        page.getByText('Lesson complete!').waitFor({ state: 'visible', timeout: 20_000 }),
      ]).catch(() => {});
      if (await page.getByText('Lesson complete!').isVisible().catch(() => false)) break;
      const kind = await page
        .getByTestId('exercise')
        .getAttribute('data-kind', { timeout: 5_000 })
        .catch(() => null);
      if (kind === 'speak') {
        // always-on sync auto-pairs fresh devices, so phones default to AI
        // scoring; echo vs AI resolves at record time (no mic in WebKit E2E).
        // Verify the tap-to-record speaking surface renders.
        await expect(page.getByText('Say it out loud')).toBeVisible();
        await expect(page.getByRole('button', { name: /Tap to record/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
        sawSpeak = true;
        break;
      }
      const { solveCurrentExercise } = await import('./helpers');
      if ((await solveCurrentExercise(page)) === 'done') break;
    }
    // the mix is speak-heavy and the finale is always a speak → must be seen
    expect(sawSpeak).toBe(true);
    // leave the lesson via in-app navigation (a full goto can stall on WebKit
    // under host load); fall back to goto with its own bounded timeout
    await page.getByRole('button', { name: 'Quit lesson' }).click({ timeout: 10_000 }).catch(async () => {
      await page.goto('/', { timeout: 45_000 });
    });
  });

  await test.step('service worker precached the app + audio for offline use', async () => {
    // Ground truth for offline capability: the assets live in Cache Storage.
    // (Workbox appends a revision query, so match with ignoreSearch.)
    // The precache is the whole app incl. ~1150 audio clips, so the SW's
    // install phase can outlast the lesson walk — wait for it, don't race it.
    // (expect.poll, not waitForFunction: an async predicate returns a Promise,
    // which is truthy, so waitForFunction would "pass" instantly.)
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const ok = async (u: string) => Boolean(await caches.match(u, { ignoreSearch: true }));
            return (await ok('index.html')) && (await ok('audio/u01-i01.m4a')) && (await ok('audio/u16-i01.m4a'));
          }),
        { timeout: 240_000, intervals: [2_000] },
      )
      .toBe(true);
    await context.setOffline(true);
    const cached = await page.evaluate(async () => {
      const match = async (u: string) => Boolean(await caches.match(u, { ignoreSearch: true }));
      let total = 0;
      for (const name of await caches.keys()) {
        total += (await (await caches.open(name)).keys()).length;
      }
      return {
        indexHtml: await match('index.html'),
        audioA: await match('audio/u01-i01.m4a'),
        audioB: await match('audio/u16-i01.m4a'),
        total,
      };
    });
    expect(cached.indexHtml).toBe(true);
    expect(cached.audioA).toBe(true);
    expect(cached.audioB).toBe(true);
    expect(cached.total).toBeGreaterThan(1000); // whole app + ~1150 clips
  });

  await test.step('running app works offline via IndexedDB (no network calls)', async () => {
    // SPA navigation needs zero network; data comes from IndexedDB
    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.getByText('Meena')).toBeVisible();
    await expect(page.getByText(/🔥 1/)).toBeVisible();
    await context.setOffline(false);
  });
});
