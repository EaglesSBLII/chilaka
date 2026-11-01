// Streak logic. Pure functions of (state, day) — no Date.now() inside.
// Days are local-calendar strings 'YYYY-MM-DD' computed via localDay().

import type { StreakState, StreakStanding } from './types';

export const MAX_FREEZES = 2;

export function emptyStreak(): StreakState {
  return { current: 0, longest: 0, lastActiveDay: null, freezesOwned: 0, freezeUsedOn: [] };
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
