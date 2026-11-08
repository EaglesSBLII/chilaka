// Coins, quests and badges: pure engine rules.
import { describe, expect, it } from 'vitest';
import { balance, celebrationLevel, chestReward, earnedTotal, milestoneFor, ownedSkus, SHOP, skuById } from '../../src/engine/coins';
import { bump, claim, dailyQuests, isComplete, questTitle } from '../../src/engine/quests';
import { BADGES, evaluateBadges, newlyEarned, reconcileBadges, tierFor, tierProgress, type BadgeStats } from '../../src/engine/badges';

describe('coins', () => {
  it('balance is the ledger sum, never negative', () => {
    expect(balance([{ delta: 10 }, { delta: 15 }, { delta: -20 }])).toBe(5);
    expect(balance([{ delta: 10 }, { delta: -50 }])).toBe(0);
    expect(earnedTotal([{ delta: 10 }, { delta: -5 }, { delta: 7 }])).toBe(17);
  });
  it('milestones and celebration levels', () => {
    expect(milestoneFor(7)).toBe(7);
    expect(milestoneFor(8)).toBeNull();
    expect(celebrationLevel(1)).toBe(0);
    expect(celebrationLevel(3)).toBe(1);
    expect(celebrationLevel(30)).toBe(2);
    expect(celebrationLevel(100)).toBe(3);
  });
  it('chest reward is deterministic and within 15..40', () => {
    const a = chestReward('2026-11-07:lessons');
    expect(a).toBe(chestReward('2026-11-07:lessons'));
    expect(a).toBeGreaterThanOrEqual(15);
    expect(a).toBeLessThanOrEqual(40);
    expect(chestReward('x')).not.toBe(chestReward('y'));
  });
  it('shop skus are unique and owned set ignores consumables', () => {
    expect(new Set(SHOP.map((s) => s.id)).size).toBe(SHOP.length);
    expect(skuById('freeze')?.consumable).toBe(true);
    const owned = ownedSkus([
      { kind: 'spend', refId: 'freeze' },
      { kind: 'spend', refId: 'crown' },
      { kind: 'lesson', refId: 'u01:l1' },
    ]);
    expect([...owned]).toEqual(['crown']);
  });
});

describe('quests', () => {
  it('two distinct quests per day, deterministic', () => {
    const a = dailyQuests('2026-11-07');
    const b = dailyQuests('2026-11-07');
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(a[0].kind).not.toBe(a[1].kind);
    expect(a[0].id).toBe(`2026-11-07:${a[0].kind}`);
    for (const q of a) expect(questTitle(q)).toBeTruthy();
  });
  it('different days differ', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    const kinds = new Set(days.flatMap((d) => dailyQuests(d).map((q) => q.kind)));
    expect(kinds.size).toBeGreaterThan(2);
  });
  it('bump caps at target; claim fixes a reward once', () => {
    const q = { ...dailyQuests('2026-11-07')[0], target: 2 };
    const q1 = bump(q, 1);
    expect(isComplete(q1)).toBe(false);
    const q2 = bump(q1, 5);
    expect(q2.progress).toBe(2);
    expect(isComplete(q2)).toBe(true);
    expect(claim(q1).claimedAt).toBeNull();
    const c = claim(q2);
    expect(c.claimedAt).toBeTruthy();
    expect(c.reward).toBeGreaterThanOrEqual(15);
    expect(bump(c, 1)).toEqual(c);
    expect(claim(c)).toEqual(c);
  });
});

describe('badges', () => {
  const zero: BadgeStats = { lessons: 0, perfectLessons: 0, longestStreak: 0, totalXp: 0, reviews: 0, cards: 0, coinsEarned: 0, unitsDone: 0 };
  it('tiers and progress', () => {
    const def = BADGES.find((b) => b.id === 'on-fire')!;
    expect(tierFor(def, 6)).toBe(0);
    expect(tierFor(def, 7)).toBe(1);
    expect(tierFor(def, 100)).toBe(3);
    expect(tierProgress(def, 0)).toEqual({ tier: 0, next: 7, pct: 0 });
    expect(tierProgress(def, 18).tier).toBe(1);
    expect(tierProgress(def, 18).pct).toBeCloseTo(11 / 23, 3);
    expect(tierProgress(def, 500)).toEqual({ tier: 3, next: null, pct: 1 });
  });
  it('evaluate, newly earned, reconcile', () => {
    expect(evaluateBadges(zero)).toEqual([]);
    const prev = evaluateBadges({ ...zero, lessons: 1 }, new Date('2026-01-01'));
    expect(prev.map((b) => `${b.id}:${b.tier}`)).toEqual(['first-steps:1']);
    const next = evaluateBadges({ ...zero, lessons: 10, totalXp: 500 }, new Date('2026-02-01'));
    expect(newlyEarned(prev, next).map((b) => `${b.id}:${b.tier}`)).toEqual(['first-steps:2', 'scholar:1']);
    const merged = reconcileBadges(prev, next);
    expect(merged.find((b) => b.id === 'first-steps')?.tier).toBe(2);
    // same tier keeps the earlier date
    const again = reconcileBadges(next, evaluateBadges({ ...zero, lessons: 10 }, new Date('2026-03-01')));
    expect(again.find((b) => b.id === 'first-steps')?.earnedAt).toBe(new Date('2026-02-01').toISOString());
  });
});
