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

  // every lesson of every unit, many seeds, first visit and replay, with and without speaking
  it('ordering holds everywhere: no repeats, runs capped at 3, intro before practice, opener and finale intact', () => {
    const firstUnit = units.find((x) => x.track !== 'script' && x.section === Math.min(...units.filter((y) => y.track !== 'script').map((y) => y.section)))!;
    let sessions = 0;
    const fails: string[] = [];
    for (const unit of units) {
      for (let li = 0; li < unit.lessons.length; li++) {
        const lesson = unit.lessons[li];
        for (let n = 0; n < 12; n++) {
          for (const replay of [false, true]) {
            for (const speak of [true, false]) {
              const seed = `${unit.id}:${lesson.id}:${1731300000000 + n * 7919}`;
              const exs = gen(unit, li, seed, replay ? lesson.itemIds : [], speak);
              const where = `${unit.id}:${lesson.id} seed ${seed} replay=${replay} speak=${speak}: ${exs.map((e) => `${e.kind}:${e.itemId.split('-')[1]}`).join(' ')}`;
              sessions++;
              const order = exs.filter((e) => e.kind !== 'intro');
              for (let i = 1; i < order.length; i++) {
                if ((order[i].kind === order[i - 1].kind && order[i].itemId === order[i - 1].itemId) !== false) fails.push(`repeat — ${where}`);
              }
              // a phrase card in between is a break; four of a kind with nothing between is not allowed
              for (let i = 3; i < exs.length; i++) {
                const run = exs[i].kind !== 'intro' && exs[i].kind === exs[i - 1].kind && exs[i].kind === exs[i - 2].kind && exs[i].kind === exs[i - 3].kind;
                if ((run) !== false) fails.push(`run of 4 — ${where}`);
              }
              // every item of the lesson is practised
              for (const id of lesson.itemIds) if ((order.some((e) => e.itemId === id)) !== true) fails.push(`unpractised ${id} — ${where}`);
              // nothing is practised before its card, except the first lesson's opener
              const opener = !replay && unit.id === firstUnit.id && lesson.id === 'l1';
              if (opener) {
                expect(exs.slice(0, 3).map((e) => `${e.kind}:${e.itemId}`), where).toEqual([
                  `listen-pick:${lesson.itemIds[0]}`,
                  `${speak ? 'speak' : 'mc-audio'}:${lesson.itemIds[0]}`,
                  `intro:${lesson.itemIds[0]}`,
                ]);
              }
              exs.forEach((e, i) => {
                if (e.kind === 'intro' || (opener && i < 2)) return;
                const intro = exs.findIndex((x) => x.kind === 'intro' && x.itemId === e.itemId);
                if ((intro < i) !== true) fails.push(`practised before its card (${e.kind}:${e.itemId}) — ${where}`);
              });
              if (!replay) for (const id of lesson.itemIds) if ((exs.some((e) => e.kind === 'intro' && e.itemId === id)) !== true) fails.push(`no card for ${id} — ${where}`);
              const last = exs[exs.length - 1];
              if (unit.track === 'script') expect(last.kind, where).toBe('type-script');
              else if (speak) expect(last.kind, where).toBe('speak');
            }
          }
        }
      }
    }
    expect(fails.slice(0, 5)).toEqual([]);
    expect(sessions).toBeGreaterThan(10_000);
  }, 120_000);

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
