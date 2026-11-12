import { describe, expect, it } from 'vitest';
import {
  comboMultiplier,
  featuredGame,
  feedRound,
  gamePool,
  GAMES,
  isScriptItem,
  learnedCount,
  memoryPairsFor,
  memoryRound,
  pairsRound,
  pickRoundItems,
  playable,
  ratingForOutcome,
  roundCoins,
  roundCounts,
  roundStars,
  roundXp,
  type GameItem,
} from '../../src/engine/games';
import { newCard, Rating } from '../../src/engine/srs';
import { trackItems } from '../../src/content/load';
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
    expect(roundXp({ outcomes: outcomes(0, 3, 0) })).toBe(1);
    expect(roundXp({ outcomes: [] })).toBe(0);
  });

  it('coins: every finished round pays, accuracy and combos pay more, capped', () => {
    expect(roundCoins({ outcomes: outcomes(8, 0, 0), bestCombo: 0 })).toBe(26);
    expect(roundCoins({ outcomes: outcomes(8, 0, 0), bestCombo: 6 })).toBe(30);
    expect(roundCoins({ outcomes: outcomes(15, 0, 0), bestCombo: 15 })).toBe(30);
    expect(roundCoins({ outcomes: outcomes(3, 3, 0), bestCombo: 3 })).toBe(13);
    // a round with not one first-try answer still pays for finishing
    expect(roundCoins({ outcomes: outcomes(0, 3, 0), bestCombo: 0 })).toBe(5);
    // after the day's full-pay rounds a finished round pays the small treat
    expect(roundCoins({ outcomes: outcomes(8, 0, 0), bestCombo: 6 }, false)).toBe(2);
    // nothing solved (the clock ran out untouched) pays nothing
    expect(roundCoins({ outcomes: [], bestCombo: 0 })).toBe(0);
    expect(roundCoins({ outcomes: outcomes(0, 0, 2), bestCombo: 0 }, false)).toBe(0);
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

describe('what the deck can actually deal', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const earlier = new Date('2026-11-01T10:00:00Z');
  const real = trackItems('speak').filter(playable).slice(0, 3);
  const long = trackItems('speak').find((it) => !playable(it));
  const deck = () => {
    const cards = Object.fromEntries(real.map((it) => [it.id, newCard(it.id, earlier)]));
    // a card whose phrase was since moved to another id, and one too long for a tile
    cards['retired-item'] = newCard('retired-item', earlier);
    if (long) cards[long.id] = newCard(long.id, earlier);
    return cards;
  };

  it('due only counts cards a game can deal: orphans and long sentences never clear, so they never count', () => {
    const pool = gamePool(deck(), now);
    expect(pool.items.map((it) => it.id).sort()).toEqual(real.map((it) => it.id).sort());
    expect(pool.dueIds.sort()).toEqual(real.map((it) => it.id).sort());
    expect(pool.dueIds).not.toContain('retired-item');
  });

  it('phrases learned ignores cards whose phrase no longer exists', () => {
    expect(learnedCount(deck())).toBe(real.length + (long ? 1 : 0));
    expect(learnedCount({})).toBe(0);
  });

  it('a single letter with a short gloss is playable', () => {
    expect(playable({ id: 'k', te: 'క', roman: 'ka', gloss: 'ka — plain k' })).toBe(true);
  });

  it('knows reading-track items, whose tiles must not show the romanisation', () => {
    const script = trackItems('script')[0];
    expect(isScriptItem(script.id)).toBe(true);
    expect(isScriptItem(real[0].id)).toBe(false);
    expect(isScriptItem('retired-item')).toBe(false);
  });
});

describe('roundCounts', () => {
  it('a round where nothing was solved is not a round played', () => {
    expect(roundCounts({ outcomes: [] })).toBe(false);
    expect(roundCounts({ outcomes: [{ itemId: 'a', firstTry: false, solved: false }] })).toBe(false);
    expect(roundCounts({ outcomes: [{ itemId: 'a', firstTry: false, solved: false }, { itemId: 'b', firstTry: false, solved: true }] })).toBe(true);
  });
});
