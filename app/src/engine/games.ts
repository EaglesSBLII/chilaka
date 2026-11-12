// Chikki's games: the arcade that replaced the flashcard review. Every round is
// built from phrases the learner has already met in lessons, with the ones
// spaced repetition says are about to be forgotten mixed in first — the player
// just sees a game, never a "review". Pure and seeded, like exercise-gen, so
// rounds are reproducible and testable.

import type { ContentItem } from './types';
import { dueCards, Rating, type StoredCard } from './srs';
import { rngFromSeed, shuffled, type Rng } from './rng';
import { itemById, trackItems } from '../content/load';

export type GameId = 'pairs' | 'feed' | 'memory';

export interface GameDef {
  id: GameId;
  name: string;
  teName: string;
  blurb: string;
  emoji: string;
  /** distinct phrases a round needs */
  minItems: number;
  /** rough length, for the card */
  length: string;
}

export const GAMES: GameDef[] = [
  {
    id: 'feed',
    name: 'Feed Chikki',
    teName: 'చిక్కీకి తిండి',
    blurb: 'Chikki says a word or a letter — tap the right fruit and feed it to her.',
    emoji: '🥭',
    minItems: 4,
    length: '~1 min',
  },
  {
    id: 'pairs',
    name: 'Pair Pop',
    teName: 'జంట జంట',
    blurb: 'Match the Telugu to its meaning or sound before the clock runs out. Combos pay extra.',
    emoji: '🎈',
    minItems: 4,
    length: '60 sec',
  },
  {
    id: 'memory',
    name: 'Memory Flip',
    teName: 'జ్ఞాపకం',
    blurb: 'Flip the cards and find each word or letter with its meaning.',
    emoji: '🃏',
    minItems: 3,
    length: '~90 sec',
  },
];

export function gameById(id: GameId): GameDef {
  return GAMES.find((g) => g.id === id)!;
}

/** The game Chikki features today — the same on every device for the day. */
export function featuredGame(day: string): GameDef {
  const rng = rngFromSeed(`featured:${day}`);
  return GAMES[Math.floor(rng() * GAMES.length)];
}

export type GameItem = Pick<ContentItem, 'id' | 'te' | 'roman' | 'gloss'>;

export interface GamePool {
  /** every learned phrase that fits a tile */
  items: GameItem[];
  /** learned phrases due for review, most overdue first */
  dueIds: string[];
  /** learned phrases, latest first */
  recentIds: string[];
}

/** What the games can draw on: the learner's spaced-repetition deck. */
export function gamePool(cards: Record<string, StoredCard>, now = new Date()): GamePool {
  const rows = Object.values(cards);
  const items = rows
    .map((c) => itemById(c.id))
    .filter((it): it is ContentItem => Boolean(it))
    .filter(playable);
  const ok = new Set(items.map((it) => it.id));
  return {
    items,
    dueIds: dueCards(rows, now).map((c) => c.id).filter((id) => ok.has(id)),
    recentIds: [...rows]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .map((c) => c.id)
      .filter((id) => ok.has(id)),
  };
}

/**
 * Phrases short enough to be a game tile (long sentences stay in lessons).
 * A single letter with a short gloss ("ka — plain k") is as playable as a word.
 */
export function playable(item: GameItem): boolean {
  return item.te.length > 0 && item.te.length <= 28 && item.gloss.length > 0 && item.gloss.length <= 40;
}

/** Cards whose phrase still exists in the course (ids retired by a content update do not count as learned). */
export function learnedCount(cards: Record<string, unknown>): number {
  let n = 0;
  for (const id of Object.keys(cards)) if (itemById(id)) n++;
  return n;
}

let scriptIds: Set<string> | null = null;
/**
 * Items of the reading & writing track. Their tiles show the Telugu alone:
 * the romanisation is the answer there, so printing it beside the letter (as
 * the speaking track does) would let the learner match without reading.
 */
export function isScriptItem(id: string): boolean {
  scriptIds ??= new Set(trackItems('script').map((it) => it.id));
  return scriptIds.has(id);
}

/**
 * Pick the phrases for a round. Due cards (most overdue first) fill about
 * 60% of the round, the latest-learned phrases the rest, and anything else
 * learned tops it up. Two tiles must never read the same, so duplicates by
 * Telugu or by meaning are skipped.
 */
export function pickRoundItems(
  pool: readonly GameItem[],
  dueIds: readonly string[],
  recentIds: readonly string[],
  n: number,
  rng: Rng,
): GameItem[] {
  const byId = new Map(pool.filter(playable).map((it) => [it.id, it]));
  const out: GameItem[] = [];
  const usedTe = new Set<string>();
  const usedGloss = new Set<string>();
  const take = (ids: readonly string[], limit: number) => {
    for (const id of ids) {
      if (out.length >= limit) return;
      const it = byId.get(id);
      if (!it) continue;
      const g = it.gloss.trim().toLowerCase();
      if (usedTe.has(it.te) || usedGloss.has(g)) continue;
      usedTe.add(it.te);
      usedGloss.add(g);
      out.push(it);
      byId.delete(id);
    }
  };
  // most overdue first; a round reschedules what it used, so the next round
  // naturally leads with different phrases
  take(dueIds, Math.ceil(n * 0.6));
  take(recentIds, n);
  take(shuffled([...byId.keys()], rng), n);
  return out;
}

// ---- Feed Chikki: listen, then tap the phrase you heard ----

export interface FeedPrompt {
  itemId: string;
  /** shuffled; includes itemId */
  choiceIds: string[];
}

export function feedRound(items: readonly GameItem[], rng: Rng, choices = 3, prompts = 8): FeedPrompt[] {
  const order = shuffled(items, rng).slice(0, prompts);
  return order.map((item) => {
    const others = shuffled(
      items.filter((o) => o.id !== item.id && o.te !== item.te && o.gloss.toLowerCase() !== item.gloss.toLowerCase()),
      rng,
    ).slice(0, Math.max(0, choices - 1));
    return { itemId: item.id, choiceIds: shuffled([item.id, ...others.map((o) => o.id)], rng) };
  });
}

// ---- Pair Pop: two columns, tap a pair ----

export interface PairsRound {
  /** every phrase of the round, in the order they enter the board */
  queue: GameItem[];
  /** pairs on the board at once */
  boardSize: number;
  seconds: number;
}

export function pairsRound(items: readonly GameItem[], rng: Rng, level: 1 | 2 = 1): PairsRound {
  const boardSize = Math.min(level === 1 ? 4 : 5, items.length);
  return { queue: shuffled(items, rng).slice(0, 15), boardSize, seconds: level === 1 ? 90 : 60 };
}

/** Combo multiplier: ×2 after three in a row, ×3 after six. */
export function comboMultiplier(streak: number): 1 | 2 | 3 {
  return streak >= 6 ? 3 : streak >= 3 ? 2 : 1;
}

// ---- Memory Flip ----

export interface MemoryCard {
  key: string;
  itemId: string;
  face: 'te' | 'gloss';
}

export function memoryRound(items: readonly GameItem[], rng: Rng, pairs: number): MemoryCard[] {
  const chosen = shuffled(items, rng).slice(0, pairs);
  const cards = chosen.flatMap((it): MemoryCard[] => [
    { key: `${it.id}:te`, itemId: it.id, face: 'te' },
    { key: `${it.id}:gloss`, itemId: it.id, face: 'gloss' },
  ]);
  return shuffled(cards, rng);
}

/** Pairs for a memory board that fits the phone: 3 (6 cards) up to 6 (12 cards). */
export function memoryPairsFor(itemCount: number, roundsPlayed: number): number {
  const ramp = roundsPlayed < 2 ? 3 : roundsPlayed < 6 ? 4 : 6;
  return Math.max(2, Math.min(ramp, itemCount));
}

// ---- Scoring, rewards and what the round teaches the scheduler ----

export interface ItemOutcome {
  itemId: string;
  /** answered right on the first try */
  firstTry: boolean;
  /** eventually answered right (false = Chikki had to show the answer) */
  solved: boolean;
}

export interface RoundResult {
  game: GameId;
  outcomes: ItemOutcome[];
  /** best combo of the round (pairs), else 0 */
  bestCombo: number;
  durationMs: number;
}

/** Rounds a day that pay full XP and coins; later rounds pay a small treat. */
export const REWARDED_ROUNDS_PER_DAY = 5;
/** Coins for finishing a round at all — a completed game never pays nothing. */
export const ROUND_BASE_COINS = 5;
/** Coins for a finished round once the day's full-pay rounds are used up. */
export const EXTRA_ROUND_COINS = 2;

/** A round counts (streak, quests, badges, the day's allowance) only if something was solved. */
export function roundCounts(r: Pick<RoundResult, 'outcomes'>): boolean {
  return r.outcomes.some((o) => o.solved);
}

export function roundXp(r: Pick<RoundResult, 'outcomes'>): number {
  if (!roundCounts(r)) return 0;
  const firstTry = r.outcomes.filter((o) => o.firstTry).length;
  const perfect = firstTry === r.outcomes.length ? 3 : 0;
  return Math.min(12, Math.max(1, firstTry + perfect));
}

/**
 * Coins for a round. `fullPay` is false after the day's rewarded rounds: the
 * round still pays a little, so playing on never feels like a broken game.
 * A round where nothing was solved (the clock ran out untouched) pays nothing.
 */
export function roundCoins(r: Pick<RoundResult, 'outcomes' | 'bestCombo'>, fullPay = true): number {
  if (!r.outcomes.some((o) => o.solved)) return 0;
  if (!fullPay) return EXTRA_ROUND_COINS;
  const firstTry = r.outcomes.filter((o) => o.firstTry).length;
  const perfect = firstTry === r.outcomes.length ? 5 : 0;
  const combo = r.bestCombo >= 6 ? 4 : r.bestCombo >= 3 ? 2 : 0;
  return Math.min(30, ROUND_BASE_COINS + firstTry * 2 + perfect + combo);
}

/** What a game answer tells spaced repetition. */
export function ratingForOutcome(o: ItemOutcome): Rating {
  if (!o.solved) return Rating.Again;
  return o.firstTry ? Rating.Good : Rating.Hard;
}

/** Stars for the summary: 3 = perfect, 2 = most right first time, 1 = finished. */
export function roundStars(r: Pick<RoundResult, 'outcomes'>): 0 | 1 | 2 | 3 {
  if (r.outcomes.length === 0) return 0;
  const pct = r.outcomes.filter((o) => o.firstTry).length / r.outcomes.length;
  return pct >= 1 ? 3 : pct >= 0.7 ? 2 : 1;
}
