// Coins: the reward currency. The balance is never stored — it is the sum of
// an append-only ledger (coinEvents) so two devices can merge without fights.
import { rngFromSeed } from './rng';
import type { BadgeDef } from './badges';

export type CoinKind = 'lesson' | 'perfect' | 'goal' | 'milestone' | 'quest' | 'badge' | 'game' | 'spend';

export interface CoinEvent {
  id?: number;
  ts: string; // ISO
  day: string; // local YYYY-MM-DD
  delta: number; // positive = earned, negative = spent
  kind: CoinKind;
  refId: string; // lesson id, quest id, badge id, sku…
}

export const COINS = {
  lesson: 10,
  perfectBonus: 15,
  goal: 20, // first time the daily goal is reached that day
  badge: 25, // per badge tier earned
} as const;

/** Streak milestones → coin bonus (and a bigger celebration). */
export const MILESTONES: Record<number, number> = {
  3: 30,
  7: 60,
  14: 100,
  30: 200,
  50: 300,
  100: 500,
  365: 1500,
};

/** The shop sku of a streak freeze: its spend events are how a bought freeze is known to every device. */
export const FREEZE_SKU = 'freeze';

/**
 * Coins due for reaching the daily goal on `day`: paid once a day, whichever
 * lesson, game or dialogue crosses the line. The ledger is the guard.
 */
export function goalBonusDue(events: readonly Pick<CoinEvent, 'kind' | 'refId'>[], day: string): number {
  return events.some((e) => e.kind === 'goal' && e.refId === day) ? 0 : COINS.goal;
}

/**
 * Coins due for the streak reaching `streak` days on `day`: paid once for that
 * day (a streak rebuilt months later earns its milestones again).
 */
export function milestoneBonusDue(events: readonly Pick<CoinEvent, 'kind' | 'refId' | 'day'>[], streak: number, day: string): number {
  const bonus = MILESTONES[streak];
  if (!bonus) return 0;
  return events.some((e) => e.kind === 'milestone' && e.refId === `streak:${streak}` && e.day === day) ? 0 : bonus;
}

export function milestoneFor(streak: number): number | null {
  return MILESTONES[streak] ? streak : null;
}

/** 0 = plain confetti, 1 = small milestone, 2 = big (30/50), 3 = legendary (100+). */
export function celebrationLevel(streak: number): 0 | 1 | 2 | 3 {
  if (streak >= 100) return 3;
  if (streak >= 30) return 2;
  if (MILESTONES[streak]) return 1;
  return 0;
}

/** Variable chest reward, deterministic per quest so both devices agree. */
export function chestReward(questId: string): number {
  const r = rngFromSeed(`chest:${questId}`)();
  return 15 + Math.floor(r * 26); // 15..40
}

export function balance(events: readonly Pick<CoinEvent, 'delta'>[]): number {
  let b = 0;
  for (const e of events) b += e.delta;
  return Math.max(0, b);
}

export function earnedTotal(events: readonly Pick<CoinEvent, 'delta'>[]): number {
  let b = 0;
  for (const e of events) if (e.delta > 0) b += e.delta;
  return b;
}

export type SkuKind = 'powerup' | 'outfit' | 'accent';
export interface Sku {
  id: string;
  kind: SkuKind;
  name: string;
  price: number;
  blurb: string;
  consumable?: boolean;
}

export const SHOP: Sku[] = [
  { id: FREEZE_SKU, kind: 'powerup', name: 'Streak freeze', price: 200, blurb: 'Protects your streak for one missed day.', consumable: true },
  { id: 'scarf', kind: 'outfit', name: 'Silk scarf', price: 150, blurb: 'A pattu scarf for Chikki.' },
  { id: 'garland', kind: 'outfit', name: 'Jasmine garland', price: 250, blurb: 'Malle poolu, always in season.' },
  { id: 'glasses', kind: 'outfit', name: 'Reading glasses', price: 300, blurb: 'For a scholarly parrot.' },
  { id: 'crown', kind: 'outfit', name: 'Golden crown', price: 500, blurb: 'Raja of the jungle.' },
  { id: 'lotus', kind: 'accent', name: 'Lotus', price: 200, blurb: 'A pink-and-rose accent theme.' },
  { id: 'peacock', kind: 'accent', name: 'Peacock', price: 200, blurb: 'Teal-and-indigo accent theme.' },
  { id: 'mango', kind: 'accent', name: 'Mango', price: 200, blurb: 'Warm mango-and-saffron theme.' },
];

export function skuById(id: string): Sku | undefined {
  return SHOP.find((s) => s.id === id);
}

/** Non-consumable items already bought (sku ids). */
export function ownedSkus(events: readonly Pick<CoinEvent, 'kind' | 'refId'>[]): Set<string> {
  const owned = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'spend') continue;
    const sku = skuById(e.refId);
    if (sku && !sku.consumable) owned.add(sku.id);
  }
  return owned;
}

/**
 * The tier to SHOW for a badge: the live stat decides, but never below a tier
 * the learner has already been awarded (a stat can fall — e.g. cards of
 * retired phrases stop counting — and an earned badge must not read "Locked").
 */
export function shownTier(def: BadgeDef, value: number, earnedTier: number): { tier: 0 | 1 | 2 | 3; next: number | null; pct: number } {
  let live: 0 | 1 | 2 | 3 = 0;
  def.tiers.forEach((th, i) => {
    if (value >= th) live = (i + 1) as 1 | 2 | 3;
  });
  const tier = Math.max(live, Math.min(3, Math.max(0, Math.floor(earnedTier)))) as 0 | 1 | 2 | 3;
  if (tier === 3) return { tier, next: null, pct: 1 };
  const next = def.tiers[tier];
  const prev = tier === 0 ? 0 : def.tiers[tier - 1];
  return { tier, next, pct: Math.max(0, Math.min(1, (value - prev) / (next - prev))) };
}
