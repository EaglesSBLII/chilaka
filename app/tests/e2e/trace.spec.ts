// Letter tracing in the Reading & Writing pathway: real pointer input on a
// touch device, the skip on computers, and the scorer against every letter of
// the course in the browser's real Telugu font.
import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeOnboarding, drawTrace, solveCurrentExercise, wipeState } from './helpers';

const unitsDir = join(dirname(fileURLToPath(import.meta.url)), '../../content/units');

async function openFirstScriptLesson(page: Page): Promise<void> {
  await wipeState(page);
  await completeOnboarding(page, 'Ravi');
  await page.getByRole('button', { name: /Read & Write/ }).click();
  await page.getByRole('button', { name: /First vowels lesson 1/i }).click();
}

/** Solve exercises until one of the wanted kind (and trace mode) is on screen. */
async function advanceTo(page: Page, mode: 'guided' | 'memory'): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const ex = page.getByTestId('exercise');
    await ex.waitFor({ state: 'visible' });
    if ((await ex.getAttribute('data-kind')) === 'trace' && (await page.locator(`[data-trace-mode="${mode}"]`).count()) > 0) return;
    expect(await solveCurrentExercise(page)).not.toBe('done');
  }
  throw new Error(`no ${mode} trace exercise appeared`);
}

test.describe('on a phone (touch screen)', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('trace a new letter over its guide, then write one from memory', async ({ page }) => {
    await openFirstScriptLesson(page);

    await test.step('the guided trace follows the letter card and has no Skip', async () => {
      await advanceTo(page, 'guided');
      await expect(page.getByRole('heading', { name: 'Trace the letter' })).toBeVisible();
      await expect(page.getByText('with your finger')).toBeVisible();
      // no big Skip in the footer on a phone, only the quiet way out
      await expect(page.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Can.t draw right now/ })).toBeVisible();
      // nothing drawn yet: Check has nothing to judge
      await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeDisabled();
    });

    await test.step('a careless scribble is not accepted', async () => {
      const box = (await page.getByTestId('trace-canvas').boundingBox())!;
      await page.mouse.move(box.x + 12, box.y + 12);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 12, box.y + 30, { steps: 8 });
      await page.mouse.move(box.x + 12, box.y + 60, { steps: 8 });
      await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
      await page.waitForTimeout(700); // longer than the auto-finish delay: it must not have fired
      await expect(page.getByTestId('exercise')).toHaveAttribute('data-phase', 'answering');
      await page.getByRole('button', { name: 'Clear' }).click();
      await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    });

    await test.step('tracing the letter finishes the exercise by itself', async () => {
      await drawTrace(page);
      await expect(page.getByTestId('exercise')).toHaveAttribute('data-phase', 'feedback');
      await expect(page.getByRole('progressbar', { name: 'Traced' })).toHaveAttribute('aria-valuenow', '100');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    });

    await test.step('from memory: write, compare with the letter, judge yourself', async () => {
      await advanceTo(page, 'memory');
      await expect(page.getByRole('heading', { name: 'Write it from memory' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Check', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Compare' })).toBeDisabled();
      await drawTrace(page);
      await page.getByRole('button', { name: 'Compare' }).click();
      await expect(page.getByText(/Does your writing match/)).toBeVisible();
      await page.getByRole('button', { name: 'Not yet' }).click();
      await expect(page.getByText('Not quite —')).toBeVisible(); // counted as a miss, comes back later
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    });

    await test.step('the lesson still completes', async () => {
      for (let i = 0; i < 40; i++) if ((await solveCurrentExercise(page)) === 'done') break;
      await expect(page.getByText('Lesson complete!')).toBeVisible();
    });
  });
});

test.describe('on a computer', () => {
  test('tracing can be skipped, or done with the mouse', async ({ page }) => {
    await openFirstScriptLesson(page);
    await advanceTo(page, 'guided');
    await expect(page.getByText('with your mouse or trackpad')).toBeVisible();
    await expect(page.getByText(/On a computer you can press Skip/)).toBeVisible();
    const itemId = await page.getByTestId('exercise').getAttribute('data-item-id');
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    // skipping moves on without a verdict
    await expect(page.getByTestId('exercise')).not.toHaveAttribute('data-kind', 'trace');
    await expect(page.getByTestId('exercise')).toHaveAttribute('data-item-id', itemId!);

    // the next letter: draw it with the mouse instead
    await advanceTo(page, 'guided');
    await drawTrace(page);
    await expect(page.getByTestId('exercise')).toHaveAttribute('data-phase', 'feedback');
  });
});

test('scorer against every traceable item in the real font', async ({ page }) => {
  const letters = new Set<string>();
  for (const f of readdirSync(unitsDir).filter((x) => x.endsWith('.json'))) {
    const u = JSON.parse(readFileSync(join(unitsDir, f), 'utf-8'));
    if (u.track === 'script') for (const it of u.items) letters.add(it.te);
  }
  await wipeState(page);
  await completeOnboarding(page);
  const report = await page.evaluate((all) => {
    type P = { x: number; y: number };
    const lab = (window as unknown as {
      __traceLab: {
        layoutTrace(te: string, w: number, h: number): { mask: { w: number; h: number } } | null;
        centreStrokes(mask: unknown): P[][];
        scoreTrace(mask: unknown, strokes: P[][]): { pass: boolean; coverage: number; accuracy: number };
        isTraceable(te: string): boolean;
        aksharaCount(te: string): number;
      };
    }).__traceLab;
    const out = { n: 0, noFont: [] as string[], clean: [] as string[], wobbly: [] as string[], half: [] as string[], scribble: [] as string[] };
    for (const te of all.filter((t) => lab.isTraceable(t))) {
      // the two sheet shapes of a 390px phone and a wide desktop column
      for (const w of [350, 536]) {
        const h = Math.round(Math.min(w, 340) * (lab.aksharaCount(te) === 1 ? 1 : 0.74));
        const g = lab.layoutTrace(te, w, h);
        if (!g) {
          out.noFont.push(te);
          continue;
        }
        out.n++;
        const pen = lab.centreStrokes(g.mask);
        const tag = `${te}@${w}`;
        if (!lab.scoreTrace(g.mask, pen).pass) out.clean.push(tag);
        // a hand that drifts up to 4 cells (about 14 px) off the line
        for (const seed0 of [7, 99, 1234]) {
          let seed = seed0;
          const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
          const wob = pen.map((s) => {
            let ox = 0;
            let oy = 0;
            return s.map((p, i) => {
              if (i % 8 === 0) {
                ox = rnd() * 4;
                oy = rnd() * 4;
              }
              return { x: p.x + ox, y: p.y + oy };
            });
          });
          if (!lab.scoreTrace(g.mask, wob).pass) out.wobbly.push(tag);
        }
        // only the left half of the letter
        const xs = pen.flat().map((p) => p.x);
        const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
        const left = pen.map((s) => s.filter((p) => p.x <= mid)).filter((s) => s.length > 0);
        if (lab.scoreTrace(g.mask, left).pass) out.half.push(tag);
        // a zigzag over the whole sheet
        const z: P[][] = [];
        for (let y = 6; y < g.mask.h - 6; y += 7) z.push([{ x: 6, y }, { x: g.mask.w - 6, y }]);
        if (lab.scoreTrace(g.mask, z).pass) out.scribble.push(tag);
      }
    }
    return out;
  }, [...letters]);
  expect(report.noFont).toEqual([]);
  expect(report.n).toBeGreaterThan(150);
  expect(report.clean).toEqual([]); // every letter's own line passes
  expect(report.wobbly).toEqual([]); // ...also from an unsteady hand
  expect(report.half).toEqual([]); // half a letter never passes
  expect(report.scribble).toEqual([]); // nor does scribbling over the sheet
});
