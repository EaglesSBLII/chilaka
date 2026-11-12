// Streak logic. Pure functions of (state, day) — no Date.now() inside.
// Days are local-calendar strings 'YYYY-MM-DD' computed via localDay().

import type { StreakState, StreakStanding } from './types';
import { FREEZE_EARN_XP } from './xp';
import { FREEZE_SKU } from './coins';

export const MAX_FREEZES = 2;

export function emptyStreak(): StreakState {
  return { current: 0, longest: 0, lastActiveDay: null, freezesOwned: 0, freezeUsedOn: [] };
}

/** The timezone this device is in right now (the calendar the learner lives by). */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Local calendar day for a timestamp in a given IANA timezone. */
export function localDay(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/** Whole days between two 'YYYY-MM-DD' strings (b - a). */
export function dayDiff(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((db - da) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface StreakUpdate {
  state: StreakState;
  extended: boolean; // streak count went up (or started)
  freezesConsumed: number;
  reset: boolean; // streak was broken and restarted at 1
}

/**
 * Record learning activity on `day`. Gaps of missed days are covered by
 * freezes when owned (one freeze per missed day), otherwise the streak resets.
 */
export function recordActivity(state: StreakState, day: string): StreakUpdate {
  const s: StreakState = { ...state, freezeUsedOn: [...state.freezeUsedOn] };
  if (s.lastActiveDay === day) {
    return { state: s, extended: false, freezesConsumed: 0, reset: false };
  }
  if (s.lastActiveDay === null) {
    s.current = 1;
    s.longest = Math.max(s.longest, 1);
    s.lastActiveDay = day;
    return { state: s, extended: true, freezesConsumed: 0, reset: false };
  }
  const diff = dayDiff(s.lastActiveDay, day);
  if (diff <= 0) {
    // clock moved backwards (timezone travel) — count as same day, keep streak
    return { state: s, extended: false, freezesConsumed: 0, reset: false };
  }
  const missed = diff - 1;
  let freezesConsumed = 0;
  let reset = false;
  if (missed === 0) {
    s.current += 1;
  } else if (missed <= s.freezesOwned) {
    for (let k = 1; k <= missed; k++) s.freezeUsedOn.push(addDays(s.lastActiveDay, k));
    s.freezesOwned -= missed;
    freezesConsumed = missed;
    s.current += 1;
  } else {
    s.current = 1;
    reset = true;
  }
  s.longest = Math.max(s.longest, s.current);
  s.lastActiveDay = day;
  return { state: s, extended: true, freezesConsumed, reset };
}

/** How the streak stands as of `today`, without mutating anything. */
export function standing(state: StreakState, today: string): StreakStanding {
  if (state.lastActiveDay === null || state.current === 0) return 'none';
  const diff = dayDiff(state.lastActiveDay, today);
  if (diff <= 0) return 'safe-done-today';
  if (diff === 1) return 'at-risk'; // practiced yesterday; today still open
  const missed = diff - 1;
  return missed <= state.freezesOwned ? 'covered-by-freeze' : 'broken';
}

/** Streak count to DISPLAY as of today (0 once it is actually broken). */
export function displayCount(state: StreakState, today: string): number {
  return standing(state, today) === 'broken' ? 0 : state.current;
}

export function grantFreeze(state: StreakState, n = 1): StreakState {
  return { ...state, freezesOwned: Math.min(MAX_FREEZES, state.freezesOwned + n) };
}

/**
 * Whether a freeze can be bought right now. A freeze protects days that have
 * not been missed yet: once the streak is already broken, buying one must not
 * repair it after the fact.
 */
export function canBuyFreeze(state: StreakState, today: string): 'ok' | 'max' | 'broken' {
  if (standing(state, today) === 'broken') return 'broken';
  if (state.freezesOwned >= MAX_FREEZES) return 'max';
  return 'ok';
}

/**
 * Freezes held, replayed from the synced ledgers instead of trusted from a
 * counter: one per FREEZE_EARN_XP of lifetime XP, one per shop purchase, one
 * gone for every day in `freezeUsedOn` — capped at MAX_FREEZES at every step,
 * exactly as the app grants and spends them. Two devices that merge the same
 * ledgers therefore agree on the count: a freeze that was paid for cannot be
 * lost to an older upload, and one earned on two devices at once is not doubled.
 */
export function freezesFromLedger(
  xpEvents: readonly { ts: string; amount: number; day: string }[],
  coinEvents: readonly { ts: string; kind: string; refId: string }[],
  freezeUsedOn: readonly string[],
): number {
  type Step = { ts: string; order: number; xp?: { amount: number; day: string } };
  const steps: Step[] = [
    ...xpEvents.map((e): Step => ({ ts: String(e.ts), order: 0, xp: { amount: Number(e.amount) || 0, day: String(e.day ?? '') } })),
    ...coinEvents.filter((e) => e.kind === 'spend' && e.refId === FREEZE_SKU).map((e): Step => ({ ts: String(e.ts), order: 1 })),
  ].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.order - b.order || (a.xp?.amount ?? 0) - (b.xp?.amount ?? 0)));
  const used = [...new Set(freezeUsedOn)].sort();
  let u = 0;
  let owned = 0;
  let total = 0;
  for (const step of steps) {
    if (!step.xp) {
      owned = Math.min(MAX_FREEZES, owned + 1);
      continue;
    }
    // a freeze covering a missed day is spent by the first activity after it
    while (u < used.length && used[u] < step.xp.day) {
      owned = Math.max(0, owned - 1);
      u++;
    }
    const next = total + step.xp.amount;
    const earned = Math.max(0, Math.floor(next / FREEZE_EARN_XP) - Math.floor(total / FREEZE_EARN_XP));
    owned = Math.min(MAX_FREEZES, owned + earned);
    total = next;
  }
  owned = Math.max(0, owned - (used.length - u));
  return owned;
}
