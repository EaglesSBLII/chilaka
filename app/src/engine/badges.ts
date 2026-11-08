// Achievements: 8 badges, 3 tiers each, evaluated from aggregate stats so
// they can be recomputed on any device after a merge.

export interface BadgeDef {
  id: string;
  name: string;
  blurb: string;
  tiers: [number, number, number];
  stat: keyof BadgeStats;
}

export interface BadgeStats {
  lessons: number;
  perfectLessons: number;
  longestStreak: number;
  totalXp: number;
  /** game rounds played (plus flashcards reviewed before the games existed) */
  reviews: number;
  cards: number;
  coinsEarned: number;
  unitsDone: number;
}

export interface BadgeRow {
  id: string;
  tier: 1 | 2 | 3;
  earnedAt: string;
}

export const BADGES: BadgeDef[] = [
  { id: 'first-steps', name: 'First steps', blurb: 'Lessons finished', tiers: [1, 10, 50], stat: 'lessons' },
  { id: 'perfectionist', name: 'Perfectionist', blurb: 'Perfect lessons', tiers: [1, 10, 50], stat: 'perfectLessons' },
  { id: 'on-fire', name: 'On fire', blurb: 'Longest streak (days)', tiers: [7, 30, 100], stat: 'longestStreak' },
  { id: 'scholar', name: 'Scholar', blurb: 'Lifetime XP', tiers: [500, 2000, 7500], stat: 'totalXp' },
  { id: 'reviewer', name: 'Game master', blurb: 'Game rounds played', tiers: [10, 50, 200], stat: 'reviews' },
  { id: 'wordsmith', name: 'Wordsmith', blurb: 'Phrases learned', tiers: [50, 200, 600], stat: 'cards' },
  { id: 'collector', name: 'Collector', blurb: 'Coins earned', tiers: [500, 2000, 10000], stat: 'coinsEarned' },
  { id: 'trailblazer', name: 'Trailblazer', blurb: 'Units completed', tiers: [4, 16, 40], stat: 'unitsDone' },
];

export function tierFor(def: BadgeDef, value: number): 0 | 1 | 2 | 3 {
  let t: 0 | 1 | 2 | 3 = 0;
  def.tiers.forEach((th, i) => {
    if (value >= th) t = (i + 1) as 1 | 2 | 3;
  });
  return t;
}

/** Progress toward the next tier: 0..1 (1 when maxed). */
export function tierProgress(def: BadgeDef, value: number): { tier: 0 | 1 | 2 | 3; next: number | null; pct: number } {
  const tier = tierFor(def, value);
  if (tier === 3) return { tier, next: null, pct: 1 };
  const next = def.tiers[tier];
  const prev = tier === 0 ? 0 : def.tiers[tier - 1];
  return { tier, next, pct: Math.max(0, Math.min(1, (value - prev) / (next - prev))) };
}

export function evaluateBadges(stats: BadgeStats, now = new Date()): BadgeRow[] {
  const out: BadgeRow[] = [];
  for (const def of BADGES) {
    const tier = tierFor(def, stats[def.stat]);
    if (tier !== 0) out.push({ id: def.id, tier, earnedAt: now.toISOString() });
  }
  return out;
}

/** Badges whose tier rose from prev → next (keeps the earlier earnedAt where unchanged). */
export function newlyEarned(prev: readonly BadgeRow[], next: readonly BadgeRow[]): BadgeRow[] {
  const before = new Map(prev.map((b) => [b.id, b.tier]));
  return next.filter((b) => (before.get(b.id) ?? 0) < b.tier);
}

/** Merge helper: keep the higher tier, the earlier earnedAt. */
export function reconcileBadges(prev: readonly BadgeRow[], next: readonly BadgeRow[]): BadgeRow[] {
  const byId = new Map<string, BadgeRow>();
  for (const b of prev) byId.set(b.id, b);
  for (const b of next) {
    const p = byId.get(b.id);
    if (!p || b.tier > p.tier) byId.set(b.id, b);
  }
  return [...byId.values()];
}
