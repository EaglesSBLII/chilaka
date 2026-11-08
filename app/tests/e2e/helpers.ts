// E2E helpers: fresh-state boot, onboarding, and a solver that answers any
// generated exercise correctly using the authored content as the answer key.

import { expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNC_ENDPOINT } from '../../src/sync-config';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawWord {
  te: string;
  gloss: string;
}
interface RawItem {
  id: string;
  te: string;
  gloss: string;
  words: RawWord[];
}

const unitsDir = join(__dirname, '../../content/units');
export const itemsById = new Map<string, RawItem>();
for (const f of readdirSync(unitsDir).filter((x) => x.endsWith('.json'))) {
  const u = JSON.parse(readFileSync(join(unitsDir, f), 'utf-8'));
  for (const it of u.items) itemsById.set(it.id, it);
}

// Mirror of engine/speech/normalize teluguToRoman is overkill here: choices
// display glosses (exact strings) and tiles/typing accept folded variants, so
// tests type the Telugu script itself (normalize folds it) or click by gloss.

/**
 * Sync auto-enables in the real app — tests must NEVER reach the live sync
 * server. Stub it: pulls 404, pushes accepted and discarded. (sync.spec
 * installs its own richer mock first; Playwright uses the newest route, so
 * this stub only catches otherwise-unmocked calls.)
 */
async function stubLiveSync(page: Page): Promise<void> {
  if (!SYNC_ENDPOINT) return;
  await page.context().route(`${SYNC_ENDPOINT}/**`, async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*' };
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() ?? '{}') as { rev?: number };
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ rev: body.rev ?? 1 }) });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
}

export async function wipeState(page: Page): Promise<void> {
  await stubLiveSync(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise<void>((resolve) => {
            if (!d.name) return resolve();
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
    );
    localStorage.clear();
  });
  await page.reload();
}

export async function completeOnboarding(page: Page, name = 'Ravi'): Promise<void> {
  await page.getByRole('button', { name: "Let's go!" }).click();
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // standard pace preselected
  await page.getByRole('button', { name: 'Start from the beginning' }).click();
  await expect(page.getByText('Section 0', { exact: false }).first()).toBeVisible();
}

/** Answer the currently shown exercise correctly. Returns the exercise kind,
 *  or 'done' if the lesson-complete screen appeared instead. */
export async function solveCurrentExercise(page: Page): Promise<string> {
  const ex = page.getByTestId('exercise');
  // The gap after the final "Continue" (award XP → render completion) can
  // briefly show neither the exercise nor the completion screen. Race them.
  await Promise.race([
    ex.waitFor({ state: 'visible', timeout: 30_000 }),
    page.getByText('Lesson complete!').waitFor({ state: 'visible', timeout: 30_000 }),
  ]).catch(() => {});
  if (await page.getByText('Lesson complete!').isVisible().catch(() => false)) return 'done';
  // read all metadata in one short-fused shot — the completion screen can
  // replace the exercise between the visibility race and this read
  let meta: { kind: string; track: string; itemId: string } | null = null;
  try {
    meta = await ex.evaluate(
      (el) => ({
        kind: el.getAttribute('data-kind') ?? '',
        track: el.getAttribute('data-track') ?? 'speak',
        itemId: el.getAttribute('data-item-id') ?? '',
      }),
      undefined,
      { timeout: 5_000 },
    );
  } catch {
    // exercise vanished mid-read — let the caller re-check completion
    return 'transient';
  }
  if (!meta?.kind || !meta.itemId) return 'transient';
  const { kind, track, itemId } = meta;
  const item = itemsById.get(itemId)!;

  try {
    return await interact();
  } catch {
    // element detached mid-action (completion screen or exercise swap) —
    // report transient so the caller re-races
    return 'transient';
  }

  async function interact(): Promise<string> {
    switch (kind) {
    case 'intro': {
      await page.getByRole('button', { name: 'Got it' }).click();
      return kind;
    }
    case 'mc-te2en':
    case 'mc-audio': {
      await ex.getByRole('button', { name: item.gloss, exact: true }).first().click();
      break;
    }
    case 'mc-en2te':
    case 'listen-pick': {
      if (track === 'script') {
        // script-track choices display the Telugu itself
        await ex.getByRole('button', { name: item.te, exact: true }).first().click();
        break;
      }
      // choices are labeled with the derived roman — compute it in-page
      const roman = await page.evaluate(
        (te) => (window as unknown as { __roman(te: string): string }).__roman(te),
        item.te,
      );
      await ex.getByRole('button', { name: roman }).first().click();
      break;
    }
    case 'wordbank': {
      for (const w of item.words) {
        const tileText =
          track === 'script'
            ? w.te // script tiles show the akshara itself
            : await page.evaluate(
                (te) => (window as unknown as { __roman(te: string): string }).__roman(te),
                w.te,
              );
        // tiles in the bank (not yet placed) are plain buttons with the word
        await ex
          .getByRole('button', { name: tileText, exact: true })
          .last() // bank buttons come after placed ones in DOM order
          .click();
      }
      break;
    }
    case 'type-script': {
      await ex.locator('textarea').fill(item.te);
      break;
    }
    case 'speak': {
      // The click can succeed while the button detaches (lesson-complete
      // renders) — don't let Playwright's retry loop hang on it.
      await page
        .getByRole('button', { name: 'Skip' })
        .click({ timeout: 8_000 })
        .catch(() => {});
      return kind;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
    }

    await page.getByRole('button', { name: 'Check', exact: true }).click({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Continue', exact: true })
      .click({ timeout: 8_000 })
      .catch(() => {}); // same detach race on the final exercise
    return kind;
  }
}

/** Run exercises until the lesson-complete screen appears. */
export async function completeLesson(page: Page, maxSteps = 40): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if (await page.getByText('Lesson complete!').isVisible().catch(() => false)) return;
    const r = await solveCurrentExercise(page);
    if (r === 'done') return;
    // 'transient' → the loop's next race settles on whatever appeared
  }
  await expect(page.getByText('Lesson complete!')).toBeVisible();
}
