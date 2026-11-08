import { describe, expect, it } from 'vitest';
import {
  comboMultiplier,
  featuredGame,
  feedRound,
  GAMES,
  memoryPairsFor,
  memoryRound,
  pairsRound,
  pickRoundItems,
  playable,
  ratingForOutcome,
  roundCoins,
  roundStars,
  roundXp,
  type GameItem,
} from '../../src/engine/games';
import { Rating } from '../../src/engine/srs';
import { rngFromSeed } from '../../src/engine/rng';

const item = (id: string, te: string, gloss: string): GameItem => ({ id, te, roman: te, gloss });
const POOL: GameItem[] = [
  item('a', 'నమస్కారం', 'hello'),
  item('b', 'ధన్యవాదాలు', 'thank you'),
  item('c', 'అవును', 'yes'),
  item('d', 'కాదు', 'no'),
  item('e', 'దయచేసి', 'please'),
  item('f', 'క్షమించండి', 'sorry'),
  item('g', 'సరే', 'okay'),
  item('h', 'వద్దు', 'no thanks'),
  item('dupTe', 'అవును', 'yes indeed'), // same Telugu as c
  item('dupGloss', 'ఔను', 'Yes'), // same meaning as c (case-insensitive)
];

describe('pickRoundItems', () => {
  it('leads with due phrases, then recent, then the rest — never duplicates by text or meaning', () => {
    const rng = rngFromSeed('t');
    const picked = pickRoundItems(POOL, ['c', 'dupTe', 'dupGloss', 'a'], ['h', 'g'], 6, rng);
    const ids = picked.map((p) => p.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toContain('c');
    expect(ids).toContain('a');
    expect(ids).not.toContain('dupTe');
    expect(ids).not.toContain('dupGloss');
    expect(ids.slice(0, 4)).toEqual(expect.arrayContaining(['h', 'g']));
  });

  it('tops up from the pool when little is due', () => {
    const picked = pickRoundItems(POOL, [], [], 5, rngFromSeed('x'));
    expect(picked).toHaveLength(5);
  });

  it('is deterministic for a seed', () => {
    const a = pickRoundItems(POOL, ['a', 'b', 'c'], ['d'], 5, rngFromSeed('same')).map((p) => p.id);
    const b = pickRoundItems(POOL, ['a', 'b', 'c'], ['d'], 5, rngFromSeed('same')).map((p) => p.id);
    expect(a).toEqual(b);
  });

  it('keeps long sentences out of the tiles', () => {
    expect(playable(item('x', 'మిమ్మల్ని కలవడం చాలా సంతోషం.', 'Very happy to meet you.'))).toBe(true);
    expect(playable(item('y', 'ఇంట్లో అందరూ బాగున్నారా? అందరూ బాగున్నారా?', 'Is everyone at home doing well?'))).toBe(false);
  });
});

describe('feedRound', () => {
  it('every prompt offers the answer plus distinct wrong choices', () => {
    const items = POOL.slice(0, 8);
    const prompts = feedRound(items, rngFromSeed('f'), 3, 8);
    expect(prompts).toHaveLength(8);
    for (const p of prompts) {
      expect(p.choiceIds).toContain(p.itemId);
      expect(new Set(p.choiceIds).size).toBe(3);
    }
    // every item is asked once
    expect(new Set(prompts.map((p) => p.itemId)).size).toBe(8);
  });

  it('never pairs an answer with a look-alike distractor', () => {
    const items = [POOL[2], POOL[8], POOL[9], POOL[0], POOL[1]]; // yes + its two doubles
    for (const p of feedRound(items, rngFromSeed('g'), 3, 5)) {
      if (p.itemId === 'c') expect(p.choiceIds).not.toEqual(expect.arrayContaining(['dupTe']));
      if (p.itemId === 'c') expect(p.choiceIds).not.toEqual(expect.arrayContaining(['dupGloss']));
    }
  });

  it('shrinks the choices when the round is tiny', () => {
    const prompts = feedRound(POOL.slice(0, 2), rngFromSeed('h'), 4, 8);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].choiceIds).toHaveLength(2);
  });
});

describe('pairsRound', () => {
  it('level 1 is a slower, smaller board', () => {
    const r1 = pairsRound(POOL.slice(0, 8), rngFromSeed('p'), 1);
    const r2 = pairsRound(POOL.slice(0, 8), rngFromSeed('p'), 2);
    expect(r1.boardSize).toBe(4);
    expect(r1.seconds).toBe(90);
    expect(r2.boardSize).toBe(5);
    expect(r2.seconds).toBe(60);
    expect(r1.queue).toHaveLength(8);
  });

  it('the board never exceeds the phrases available', () => {
    expect(pairsRound(POOL.slice(0, 3), rngFromSeed('p'), 2).boardSize).toBe(3);
  });

  it('combo multiplier steps at 3 and 6', () => {
    expect([0, 1, 2, 3, 5, 6, 9].map(comboMultiplier)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });
});

describe('memoryRound', () => {
  it('deals two cards per phrase, one Telugu and one meaning, shuffled', () => {
    const cards = memoryRound(POOL.slice(0, 8), rngFromSeed('m'), 4);
    expect(cards).toHaveLength(8);
    const byItem = new Map<string, string[]>();
    for (const c of cards) byItem.set(c.itemId, [...(byItem.get(c.itemId) ?? []), c.face]);
    expect(byItem.size).toBe(4);
    for (const faces of byItem.values()) expect(faces.sort()).toEqual(['gloss', 'te']);
    expect(new Set(cards.map((c) => c.key)).size).toBe(8);
  });

  it('board size ramps with experience and is capped by what is learned', () => {
    expect(memoryPairsFor(20, 0)).toBe(3);
    expect(memoryPairsFor(20, 3)).toBe(4);
    expect(memoryPairsFor(20, 10)).toBe(6);
    expect(memoryPairsFor(3, 10)).toBe(3);
  });
});

describe('rewards and scheduling', () => {
  const outcomes = (firstTry: number, hard: number, missed: number) => [
    ...Array.from({ length: firstTry }, (_, i) => ({ itemId: `a${i}`, firstTry: true, solved: true })),
    ...Array.from({ length: hard }, (_, i) => ({ itemId: `b${i}`, firstTry: false, solved: true })),
    ...Array.from({ length: missed }, (_, i) => ({ itemId: `c${i}`, firstTry: false, solved: false })),
  ];

  it('XP is one per first-try answer with a perfect bonus, capped', () => {
    expect(roundXp({ outcomes: outcomes(8, 0, 0) })).toBe(11);
    expect(roundXp({ outcomes: outcomes(5, 2, 1) })).toBe(5);
    expect(roundXp({ outcomes: outcomes(15, 0, 0) })).toBe(12);
    expect(roundXp({ outcomes: [] })).toBe(0);
  });

  it('coins reward accuracy and combos, capped', () => {
    expect(roundCoins({ outcomes: outcomes(8, 0, 0), bestCombo: 0 })).toBe(21);
    expect(roundCoins({ outcomes: outcomes(8, 0, 0), bestCombo: 6 })).toBe(25);
    expect(roundCoins({ outcomes: outcomes(3, 3, 0), bestCombo: 3 })).toBe(8);
  });

  it('stars follow first-try accuracy', () => {
    expect(roundStars({ outcomes: outcomes(8, 0, 0) })).toBe(3);
    expect(roundStars({ outcomes: outcomes(6, 2, 0) })).toBe(2);
    expect(roundStars({ outcomes: outcomes(2, 2, 4) })).toBe(1);
    expect(roundStars({ outcomes: [] })).toBe(0);
  });

  it('maps outcomes to spaced-repetition ratings', () => {
    expect(ratingForOutcome({ itemId: 'x', firstTry: true, solved: true })).toBe(Rating.Good);
    expect(ratingForOutcome({ itemId: 'x', firstTry: false, solved: true })).toBe(Rating.Hard);
    expect(ratingForOutcome({ itemId: 'x', firstTry: false, solved: false })).toBe(Rating.Again);
  });

  it('the featured game is stable per day and covers every game', () => {
    expect(featuredGame('2026-11-08')).toBe(featuredGame('2026-11-08'));
    const seen = new Set<string>();
    for (let d = 1; d <= 30; d++) seen.add(featuredGame(`2026-11-${String(d).padStart(2, '0')}`).id);
    expect(seen.size).toBe(GAMES.length);
  });
});
