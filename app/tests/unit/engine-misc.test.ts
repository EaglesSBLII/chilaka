import { describe, expect, it } from 'vitest';
import { DAILY_GOAL_XP, freezesEarned, LEVELS, levelForXp, lessonCompletionBonus, nextLevel, xpForExercise } from '../../src/engine/xp';
import { dueCards, newCard, Rating, ratingForOutcome, reviewCard } from '../../src/engine/srs';
import { answerPlacement, nextPlacementItem, startPlacement, startSectionForTier, type PlacementQuestionRef } from '../../src/engine/placement';
import { hashString, rngFromSeed, shuffled } from '../../src/engine/rng';

describe('xp', () => {
  it('wrong answers earn nothing', () => {
    expect(xpForExercise('mc-te2en', false)).toBe(0);
  });
  it('production tasks pay more than recognition', () => {
    expect(xpForExercise('speak', true)).toBeGreaterThan(xpForExercise('mc-te2en', true));
  });
  it('levels are ascending and start at 0', () => {
    expect(LEVELS[0].minXp).toBe(0);
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i].minXp).toBeGreaterThan(LEVELS[i - 1].minXp);
  });
  it('levelForXp picks the highest reached', () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(100).level).toBe(2);
    expect(levelForXp(299).level).toBe(2);
    expect(levelForXp(999999).level).toBe(10);
  });
  it('nextLevel returns null at max', () => {
    expect(nextLevel(999999)).toBeNull();
    expect(nextLevel(0)?.level).toBe(2);
  });
  it('freezesEarned counts 300-XP crossings', () => {
    expect(freezesEarned(0, 299)).toBe(0);
    expect(freezesEarned(299, 301)).toBe(1);
    expect(freezesEarned(0, 650)).toBe(2);
    expect(freezesEarned(600, 600)).toBe(0);
  });
  it('perfect lesson pays max bonus', () => {
    expect(lessonCompletionBonus(1)).toBeGreaterThan(lessonCompletionBonus(0.8));
  });
  it('daily goals are ordered', () => {
    expect(DAILY_GOAL_XP.relaxed).toBeLessThan(DAILY_GOAL_XP.standard);
    expect(DAILY_GOAL_XP.standard).toBeLessThan(DAILY_GOAL_XP.intense);
  });
});

describe('srs', () => {
  const now = new Date('2026-07-15T12:00:00Z');

  it('new card is due immediately', () => {
    const c = newCard('u01-i01', now);
    expect(new Date(c.due).getTime()).toBeLessThanOrEqual(now.getTime());
    expect(c.reps).toBe(0);
  });

  it('Good review schedules into the future and increments reps', () => {
    const c = newCard('u01-i01', now);
    const r = reviewCard(c, Rating.Good, now);
    expect(new Date(r.due).getTime()).toBeGreaterThan(now.getTime());
    expect(r.reps).toBe(1);
    expect(r.last_review).toBe(now.toISOString());
  });

  it('Easy schedules further than Again', () => {
    const c = newCard('u01-i01', now);
    const easy = reviewCard(c, Rating.Easy, now);
    const again = reviewCard(c, Rating.Again, now);
    expect(new Date(easy.due).getTime()).toBeGreaterThan(new Date(again.due).getTime());
  });

  it('repeated Good reviews grow the interval monotonically', () => {
    let c = newCard('u01-i01', now);
    let prevInterval = 0;
    let t = now;
    for (let i = 0; i < 5; i++) {
      c = reviewCard(c, Rating.Good, t);
      const interval = new Date(c.due).getTime() - t.getTime();
      expect(interval).toBeGreaterThanOrEqual(prevInterval);
      prevInterval = interval;
      t = new Date(c.due);
    }
    // after 5 Good reviews the card should be weeks out
    expect(prevInterval).toBeGreaterThan(7 * 86400000);
  });

  it('dueCards filters and sorts most-overdue-first', () => {
    const a = { ...newCard('a', now), due: '2026-07-10T00:00:00Z' };
    const b = { ...newCard('b', now), due: '2026-07-14T00:00:00Z' };
    const c = { ...newCard('c', now), due: '2026-08-01T00:00:00Z' };
    const due = dueCards([c, b, a], now);
    expect(due.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('ratingForOutcome maps outcomes', () => {
    expect(ratingForOutcome(false, false)).toBe(Rating.Again);
    expect(ratingForOutcome(true, true)).toBe(Rating.Hard);
    expect(ratingForOutcome(true, false)).toBe(Rating.Good);
  });
});

describe('placement', () => {
  const bank: PlacementQuestionRef[] = [];
  for (let t = 1 as 1 | 2 | 3 | 4 | 5; t <= 5; t++) {
    for (let i = 0; i < 4; i++) bank.push({ itemId: `p${t}-${i}`, tier: t as 1 | 2 | 3 | 4 | 5 });
  }

  it('starts at tier 2', () => {
    expect(startPlacement().tier).toBe(2);
  });

  it('all correct climbs to tier 5 and settles there', () => {
    let s = startPlacement();
    while (!s.done) {
      const q = nextPlacementItem(s, bank)!;
      s = answerPlacement(s, q, true);
    }
    expect(s.resultTier).toBe(5);
    expect(startSectionForTier(5)).toBe(8);
  });

  it('all wrong settles at 0 → section 0', () => {
    let s = startPlacement();
    while (!s.done) {
      const q = nextPlacementItem(s, bank)!;
      s = answerPlacement(s, q, false);
    }
    expect(s.resultTier).toBe(0);
    expect(startSectionForTier(0)).toBe(0);
  });

  it('passing tier 2 then failing tier 3 settles at 2', () => {
    let s = startPlacement();
    // two correct at tier 2 → advance to 3
    s = answerPlacement(s, 'p2-0', true);
    s = answerPlacement(s, 'p2-1', true);
    expect(s.tier).toBe(3);
    s = answerPlacement(s, 'p3-0', false);
    // dropped to tier 2, answer one more correct there, then fail 3 twice total
    expect(s.tier).toBe(2);
    s = answerPlacement(s, 'p2-2', true);
    expect(s.tier).toBe(3);
    s = answerPlacement(s, 'p3-1', false);
    expect(s.done).toBe(true);
    expect(s.resultTier).toBe(2);
    expect(startSectionForTier(2)).toBe(3);
  });

  it('never exceeds max questions', () => {
    let s = startPlacement();
    let flip = false;
    while (!s.done) {
      const q = nextPlacementItem(s, bank);
      if (!q) break;
      flip = !flip;
      s = answerPlacement(s, q, flip);
    }
    expect(s.asked.length).toBeLessThanOrEqual(18);
  });
});

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = rngFromSeed('lesson-u01-l1');
    const b = rngFromSeed('lesson-u01-l1');
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it('different seeds differ', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
  });
  it('shuffled preserves elements', () => {
    const rng = rngFromSeed('x');
    const out = shuffled([1, 2, 3, 4, 5], rng);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
