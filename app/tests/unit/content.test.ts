// Content integrity gate. Every authored unit must pass before it ships.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authoredUnitSchema, type AuthoredUnit } from '../../src/content/schema';
import { loadUnit } from '../../src/content/load';
import { isTelugu } from '../../src/engine/speech/normalize';

const unitsDir = join(__dirname, '../../content/units');
const files = readdirSync(unitsDir).filter((f) => f.endsWith('.json'));

const parsed: AuthoredUnit[] = files.map((f) => {
  const raw = JSON.parse(readFileSync(join(unitsDir, f), 'utf-8'));
  const res = authoredUnitSchema.safeParse(raw);
  if (!res.success) {
    throw new Error(`${f}: schema errors:\n${JSON.stringify(res.error.issues.slice(0, 5), null, 2)}`);
  }
  return res.data;
});

const allItemIds = new Set(parsed.flatMap((u) => u.items.map((i) => i.id)));

function stripPunct(s: string): string {
  return s.replace(/[.,!?'"‘’“”\-–]/gu, '').trim();
}

describe('content: units', () => {
  it('at least one unit exists', () => {
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('unit ids are unique and match filenames', () => {
    const ids = parsed.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < files.length; i++) {
      expect(files[i]).toBe(`${parsed[i].id}.json`);
    }
  });

  it('(track, section, order) triples are unique', () => {
    const keys = parsed.map((u) => `${u.track}:${u.section}:${u.order}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('item ids are globally unique and prefixed with their unit id', () => {
    const ids = parsed.flatMap((u) => u.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const u of parsed) {
      for (const item of u.items) {
        expect(item.id.startsWith(`${u.id}-`), `${item.id} in ${u.id}`).toBe(true);
      }
    }
  });
});

describe('content: per-unit integrity', () => {
  for (const u of parsed) {
    describe(u.id, () => {
      const ownIds = new Set(u.items.map((i) => i.id));

      it('lessons reference own items; every item is taught in some lesson', () => {
        const inLessons = new Set<string>();
        for (const l of u.lessons) {
          for (const id of l.itemIds) {
            expect(ownIds.has(id), `${u.id}:${l.id} references ${id}`).toBe(true);
            inLessons.add(id);
          }
        }
        for (const id of ownIds) {
          expect(inLessons.has(id), `${id} not taught in any lesson`).toBe(true);
        }
      });

      it('dialogue turns resolve to own items', () => {
        if (!u.dialogue) return;
        for (const t of u.dialogue.turns) {
          expect(ownIds.has(t.itemId), `dialogue references ${t.itemId}`).toBe(true);
        }
        expect(u.dialogue.turns.some((t) => t.userTurn)).toBe(true);
      });

      it('distractors resolve globally and never self-reference', () => {
        for (const item of u.items) {
          for (const d of item.distractors ?? []) {
            expect(allItemIds.has(d), `${item.id} distractor ${d} missing`).toBe(true);
            expect(d).not.toBe(item.id);
          }
        }
      });

      it('word breakdowns match the sentence', () => {
        for (const item of u.items) {
          if (u.track === 'script') {
            // script items: words[] is the akshara decomposition — joined
            // together (no spaces) it must reproduce the text exactly
            const joined = item.words.map((w) => w.te).join('');
            expect(stripPunct(joined).replace(/\s+/g, ''), `${item.id}: akshara pieces must join to te`).toBe(
              stripPunct(item.te).replace(/\s+/g, ''),
            );
          } else {
            const tokens = item.te.split(/\s+/).map(stripPunct).filter(Boolean);
            const wordTes = item.words.map((w) => stripPunct(w.te));
            expect(wordTes, `${item.id}: words[] must match sentence tokens`).toEqual(tokens);
          }
        }
      });

      it('romanization fully transliterates (no Telugu leaks through)', () => {
        const unit = loadUnit(u);
        for (const item of unit.items) {
          expect(isTelugu(item.roman), `${item.id} roman "${item.roman}"`).toBe(false);
          expect(item.roman.length).toBeGreaterThan(0);
          for (const w of item.words) {
            expect(isTelugu(w.roman), `${item.id} word roman "${w.roman}"`).toBe(false);
          }
        }
      });

      it('no two items share te or (lower-cased) gloss', () => {
        const tes = new Set<string>();
        const glosses = new Set<string>();
        for (const item of u.items) {
          expect(tes.has(item.te), `${item.id}: duplicate te "${item.te}"`).toBe(false);
          tes.add(item.te);
          const g = item.gloss.toLowerCase();
          expect(glosses.has(g), `${item.id}: duplicate gloss "${item.gloss}"`).toBe(false);
          glosses.add(g);
        }
      });

      it('difficulty fits the section band (soft ±1)', () => {
        const bands: Record<string, Record<number, [number, number]>> = {
          speak: { 0: [1, 1], 1: [1, 3], 2: [1, 4], 3: [2, 5], 4: [2, 4], 5: [2, 4], 6: [3, 5], 7: [2, 5], 8: [3, 5] },
          script: { 1: [1, 3], 2: [1, 4] },
        };
        const [lo, hi] = bands[u.track]?.[u.section] ?? [1, 5];
        for (const item of u.items) {
          expect(item.difficulty, `${item.id} difficulty ${item.difficulty}`).toBeGreaterThanOrEqual(lo);
          expect(item.difficulty, `${item.id} difficulty ${item.difficulty}`).toBeLessThanOrEqual(hi);
        }
      });
    });
  }
});
