// Coins: the reward currency. The balance is never stored — it is the sum of
// an append-only ledger (coinEvents) so two devices can merge without fights.
import { rngFromSeed } from './rng';

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
  { id: 'freeze', kind: 'powerup', name: 'Streak freeze', price: 200, blurb: 'Protects your streak for one missed day.', consumable: true },
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
