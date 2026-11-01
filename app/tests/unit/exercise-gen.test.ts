import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { genLessonExercises } from '../../src/engine/exercise-gen';
import { loadUnit } from '../../src/content/load';
import type { Unit } from '../../src/engine/types';

const unitsDir = join(__dirname, '../../content/units');
const units: Unit[] = readdirSync(unitsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => loadUnit(JSON.parse(readFileSync(join(unitsDir, f), 'utf-8'))));
const pool = units.flatMap((u) => u.items);

function gen(unit: Unit, lessonIdx: number, seed: string, seen: string[] = [], includeSpeak = true) {
  return genLessonExercises(unit, unit.lessons[lessonIdx], {
    seed,
    seenItemIds: new Set(seen),
    includeSpeak,
    pool,
  });
}

describe('exercise generation v2', () => {
  const u = units[0];

  it('is deterministic for a seed', () => {
    const a = gen(u, 0, 'seed-x');
    const b = gen(u, 0, 'seed-x');
    expect(a).toEqual(b);
  });

  it('different seeds vary the sequence (teach patterns rotate)', () => {
    const signatures = new Set(
      ['s1', 's2', 's3', 's4', 's5', 's6'].map((s) =>
        gen(u, 0, s)
          .map((e) => e.kind)
          .join(','),
      ),
    );
    expect(signatures.size).toBeGreaterThan(2);
  });

  it('speaking dominates the graded mix (talking-first)', () => {
    // average across several lessons/seeds
    let speak = 0;
    let graded = 0;
    for (const unit of units.slice(0, 6)) {
      for (let li = 0; li < unit.lessons.length; li++) {
        for (const seed of ['a', 'b']) {
          for (const ex of gen(unit, li, seed)) {
            if (ex.kind === 'intro') continue;
            graded++;
            if (ex.kind === 'speak') speak++;
          }
        }
      }
    }
    expect(speak / graded).toBeGreaterThan(0.45);
  });

  it('every exercise references an item in the lesson', () => {
    for (const seed of ['q1', 'q2']) {
      const lessonIds = new Set(u.lessons[0].itemIds);
      for (const ex of gen(u, 0, seed)) {
        expect(lessonIds.has(ex.itemId)).toBe(true);
      }
    }
  });

  it('seen items get no intro cards', () => {
    const exercises = gen(u, 0, 'z', u.lessons[0].itemIds);
    expect(exercises.some((e) => e.kind === 'intro')).toBe(false);
  });

  it('same-kind runs are capped at 3 (excluding intros)', () => {
    for (const unit of units.slice(0, 8)) {
      for (const seed of ['r1', 'r2', 'r3']) {
        const ks = gen(unit, 0, seed)
          .map((e) => e.kind)
          .filter((k) => k !== 'intro');
        for (let i = 3; i < ks.length; i++) {
          const run = ks[i] === ks[i - 1] && ks[i] === ks[i - 2] && ks[i] === ks[i - 3];
          expect(run, `${unit.id} seed ${seed}: ${ks.join(',')}`).toBe(false);
        }
      }
    }
  });

  it('without speak support the mix still works and ends with production', () => {
    const exercises = gen(u, 0, 'nospeak', [], false);
    expect(exercises.some((e) => e.kind === 'speak')).toBe(false);
    const last = exercises[exercises.length - 1];
    expect(['wordbank', 'listen-pick']).toContain(last.kind);
  });

  it('finale is a speak exercise', () => {
    const exercises = gen(u, 0, 'fin');
    expect(exercises[exercises.length - 1].kind).toBe('speak');
  });

  it('choice exercises carry 2-4 choices including the answer', () => {
    for (const ex of gen(u, 0, 'c1')) {
      if ('choiceIds' in ex) {
        expect(ex.choiceIds.length).toBeGreaterThanOrEqual(2);
        expect(ex.choiceIds.length).toBeLessThanOrEqual(4);
        expect(ex.choiceIds).toContain(ex.itemId);
      }
    }
  });
});

describe('script-track generation (reading & writing)', () => {
  const scriptUnit = units.find((u) => u.track === 'script');

  it('a script unit is loaded', () => {
    expect(scriptUnit).toBeTruthy();
  });

  it('script lessons contain writing (type-script) and never speaking', () => {
    if (!scriptUnit) return;
    for (const seed of ['s1', 's2', 's3']) {
      const exercises = genLessonExercises(scriptUnit, scriptUnit.lessons[0], {
        seed,
        seenItemIds: new Set(),
        includeSpeak: true, // even when the platform could speak
        pool: scriptUnit.items,
      });
      expect(exercises.some((e) => e.kind === 'type-script')).toBe(true);
      expect(exercises.some((e) => e.kind === 'speak')).toBe(false);
      // finale is always writing
      expect(exercises[exercises.length - 1].kind).toBe('type-script');
    }
  });

  it('script wordbank tiles are aksharas (Telugu script), not roman', () => {
    if (!scriptUnit) return;
    for (const seed of ['t1', 't2', 't3', 't4']) {
      for (const lesson of scriptUnit.lessons) {
        const exercises = genLessonExercises(scriptUnit, lesson, {
          seed,
          seenItemIds: new Set(),
          includeSpeak: false,
          pool: scriptUnit.items,
        });
        for (const ex of exercises) {
          if ('tiles' in ex) {
            for (const tile of ex.tiles) {
              expect(/[ఀ-౿]/.test(tile), `tile "${tile}" should be Telugu`).toBe(true);
            }
          }
        }
      }
    }
  });
});
