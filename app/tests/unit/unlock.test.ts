import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unitStatus } from '../../src/engine/unlock';
import { loadUnit } from '../../src/content/load';
import type { Unit } from '../../src/engine/types';

const dir = join(__dirname, '../../content/units');
const units: Unit[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => loadUnit(JSON.parse(readFileSync(join(dir, f), 'utf-8'))))
  .sort((x, y) => (x.track === 'script' ? 1 : 0) - (y.track === 'script' ? 1 : 0) || x.section - y.section || x.order - y.order);
const all = (u: Unit) => ({ lessonsDone: u.lessons.map((l) => l.id) });

describe('unit unlock rule', () => {
  it('a learner who finishes units in order can reach every unit, for every start section', () => {
    for (const start of [undefined, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const track of ['speak', 'script'] as const) {
        const progress: Record<string, { lessonsDone: string[] }> = {};
        for (const u of units.filter((x) => x.track === track)) {
          expect(unitStatus(units, u.id, progress, start), `${u.id} start=${start}`).toBe('active');
          progress[u.id] = all(u);
          expect(unitStatus(units, u.id, progress, start)).toBe('done');
        }
      }
    }
  });

  it('a fresh learner cannot open a unit past the first one at the start section', () => {
    const speak = units.filter((u) => u.track === 'speak');
    const firstAtOne = speak.findIndex((u) => u.section === 1);
    expect(unitStatus(units, speak[firstAtOne].id, {}, 1)).toBe('active');
    expect(unitStatus(units, speak[firstAtOne + 1].id, {}, 1)).toBe('locked');
    expect(unitStatus(units, speak[0].id, {}, 1)).toBe('active'); // section 0 stays open
    const script = units.filter((u) => u.track === 'script');
    expect(unitStatus(units, script[1].id, {}, 1)).toBe('locked');
  });

  it('a unit already started stays open when a new unit is slotted in before it', () => {
    // 0.5.0 put u91 in front of u87: a learner part-way through u87 has no progress in u91
    const script = units.filter((u) => u.track === 'script');
    const i = script.findIndex((u) => u.id === 'u87');
    expect(script[i - 1].id).toBe('u91');
    const progress: Record<string, { lessonsDone: string[] }> = { u87: { lessonsDone: ['l1', 'l2'] } };
    for (const u of script.slice(0, i - 1)) progress[u.id] = all(u);
    expect(unitStatus(units, 'u87', progress, 1)).toBe('active');
    expect(unitStatus(units, 'u91', progress, 1)).toBe('active');
    expect(unitStatus(units, script[i + 1].id, progress, 1)).toBe('locked');
  });
});
