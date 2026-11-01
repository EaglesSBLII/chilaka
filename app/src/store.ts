// Central app state (zustand). Hydrates from Dexie once at boot; every
// mutation persists back inside the action. UI components never touch db.

import { create } from 'zustand';
import { db, type LessonProgressRow, type ProfileRow, type ReminderRow, type StreakRow, type UnitProgressRow } from './db/schema';
import { exportAll, importAll } from './db/backup';
import { emptyStreak, grantFreeze, localDay, recordActivity, standing, displayCount } from './engine/streak';
import { freezesEarned, DAILY_GOAL_XP } from './engine/xp';
import { newCard, reviewCard, dueCards, type StoredCard, Rating } from './engine/srs';
import type { Difficulty, ScriptMode, StreakStanding } from './engine/types';
import { allUnits } from './content/load';
import { platform } from './platform';

export type View =
  | { name: 'onboarding' }
  | { name: 'placement' }
  | { name: 'path' }
  | { name: 'lesson'; unitId: string; lessonId: string }
  | { name: 'dialogue'; unitId: string }
  | { name: 'review' }
  | { name: 'profile' }
  | { name: 'settings' };

export interface XpAward {
  amount: number;
  streakExtended: boolean;
  streakCount: number;
  freezesEarnedNow: number;
  freezesConsumed: number;
  goalJustReached: boolean;
}

interface AppState {
  loaded: boolean;
  view: View;
  profile: ProfileRow | null;
  streak: StreakRow;
  totalXp: number;
  todayXp: number;
  unitProgress: Record<string, UnitProgressRow>;
  lessonProgress: Record<string, LessonProgressRow>;
  srsCards: Record<string, StoredCard>;
  reminders: ReminderRow[];

  navigate(view: View): void;
  init(): Promise<void>;
  createProfile(name: string, difficulty: Difficulty): Promise<void>;
  finishPlacement(startSection: number): Promise<void>;
  skipPlacement(): Promise<void>;
  setDifficulty(d: Difficulty): Promise<void>;
  setScriptMode(m: ScriptMode): Promise<void>;
  setSoundOn(on: boolean): Promise<void>;
  awardXp(amount: number, source: 'lesson' | 'review' | 'speak' | 'dialogue' | 'placement' | 'bonus', refId: string): Promise<XpAward>;
  introduceItems(itemIds: string[]): Promise<void>;
  applyReview(itemId: string, rating: Rating): Promise<void>;
  completeLesson(unitId: string, lessonId: string, pct: number, xp: number): Promise<void>;
  completeDialogue(unitId: string): Promise<void>;
  saveReminders(rows: Omit<ReminderRow, 'id'>[]): Promise<void>;
  exportBackupJson(): Promise<string>;
  importBackupJson(json: string): Promise<void>;
}

function today(profile: ProfileRow | null): string {
  const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return localDay(new Date(), tz);
}

export const useApp = create<AppState>((set, get) => ({
  loaded: false,
  view: { name: 'path' },
  profile: null,
  streak: { id: 'main', ...emptyStreak() },
  totalXp: 0,
  todayXp: 0,
  unitProgress: {},
  lessonProgress: {},
  srsCards: {},
  reminders: [],

  navigate(view) {
    set({ view });
    window.scrollTo(0, 0);
  },

  async init() {
    const profile = (await db.profile.get('main')) ?? null;
    const streak = (await db.streaks.get('main')) ?? { id: 'main', ...emptyStreak() };
    const unitProgress = Object.fromEntries((await db.unitProgress.toArray()).map((r) => [r.unitId, r]));
    const lessonProgress = Object.fromEntries((await db.lessonProgress.toArray()).map((r) => [r.id, r]));
    const srsCards = Object.fromEntries((await db.srsCards.toArray()).map((r) => [r.id, r]));
    const reminders = await db.reminders.toArray();
    const events = await db.xpEvents.toArray();
    const totalXp = events.reduce((s, e) => s + e.amount, 0);
    const day = today(profile);
    const todayXp = events.filter((e) => e.day === day).reduce((s, e) => s + e.amount, 0);
    const wasLoaded = get().loaded;
    set({
      loaded: true,
      profile,
      streak,
      unitProgress,
      lessonProgress,
      srsCards,
      reminders,
      totalXp,
      todayXp,
      // First boot decides the landing view; re-hydration (e.g. after a
      // backup import) keeps the user where they are.
      view: wasLoaded ? get().view : profile?.onboarded ? { name: 'path' } : { name: 'onboarding' },
    });
    void platform.requestPersistence();
    if (reminders.length > 0) {
      void platform.setReminders(reminders.map(({ hh, mm, enabled, label }) => ({ hh, mm, enabled, label })));
    }
  },

  async createProfile(name, difficulty) {
    const profile: ProfileRow = {
      id: 'main',
      name,
      createdAt: new Date().toISOString(),
      onboarded: true,
      placementDone: false,
      startSection: 1,
      difficulty,
      scriptMode: 'roman+telugu',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      soundOn: true,
    };
    await db.profile.put(profile);
    set({ profile });
  },

  async finishPlacement(startSection) {
    const profile = { ...get().profile!, placementDone: true, startSection };
    await db.profile.put(profile);
    set({ profile, view: { name: 'path' } });
  },

  async skipPlacement() {
    const profile = { ...get().profile!, placementDone: true, startSection: 1 };
    await db.profile.put(profile);
    set({ profile, view: { name: 'path' } });
  },

  async setDifficulty(difficulty) {
    const profile = { ...get().profile!, difficulty };
    await db.profile.put(profile);
    set({ profile });
  },

  async setScriptMode(scriptMode) {
    const profile = { ...get().profile!, scriptMode };
    await db.profile.put(profile);
    set({ profile });
  },

  async setSoundOn(soundOn) {
    const profile = { ...get().profile!, soundOn };
    await db.profile.put(profile);
    set({ profile });
  },

  async awardXp(amount, source, refId) {
    const state = get();
    const day = today(state.profile);
    const prevTotal = state.totalXp;
    const goalBefore = state.todayXp >= DAILY_GOAL_XP[state.profile?.difficulty ?? 'standard'];

    const upd = recordActivity(state.streak, day);
    let streakState = upd.state;
    const earned = freezesEarned(prevTotal, prevTotal + amount);
    if (earned > 0) streakState = grantFreeze(streakState, earned);
    const streak: StreakRow = { id: 'main', ...streakState };

    await db.transaction('rw', [db.streaks, db.xpEvents], async () => {
      await db.streaks.put(streak);
      await db.xpEvents.add({ ts: new Date().toISOString(), amount, source, refId, day });
    });

    const totalXp = prevTotal + amount;
    const todayXp = state.todayXp + amount;
    set({ streak, totalXp, todayXp });
    // every progress event funnels through here — nudge the cross-device sync
    void import('./sync').then(({ sync }) => sync.requestSync());
    const goalNow = todayXp >= DAILY_GOAL_XP[state.profile?.difficulty ?? 'standard'];
    return {
      amount,
      streakExtended: upd.extended,
      streakCount: streak.current,
      freezesEarnedNow: earned,
      freezesConsumed: upd.freezesConsumed,
      goalJustReached: goalNow && !goalBefore,
    };
  },

  async introduceItems(itemIds) {
    const now = new Date();
    const cards = { ...get().srsCards };
    const fresh: StoredCard[] = [];
    for (const id of itemIds) {
      if (!cards[id]) {
        const c = newCard(id, now);
        cards[id] = c;
        fresh.push(c);
      }
    }
    if (fresh.length > 0) {
      await db.srsCards.bulkPut(fresh);
      set({ srsCards: cards });
    }
  },

  async applyReview(itemId, rating) {
    const card = get().srsCards[itemId];
    if (!card) return;
    const next = reviewCard(card, rating, new Date());
    await db.srsCards.put(next);
    set({ srsCards: { ...get().srsCards, [itemId]: next } });
  },

  async completeLesson(unitId, lessonId, pct, xp) {
    const id = `${unitId}:${lessonId}`;
    const prev = get().lessonProgress[id];
    const row: LessonProgressRow = {
      id,
      attempts: (prev?.attempts ?? 0) + 1,
      bestPct: Math.max(prev?.bestPct ?? 0, pct),
      lastCompletedAt: new Date().toISOString(),
      xpEarned: (prev?.xpEarned ?? 0) + xp,
    };
    const up: UnitProgressRow = get().unitProgress[unitId] ?? {
      unitId,
      lessonsDone: [],
      dialogueDone: false,
      completedAt: null,
    };
    const lessonsDone = up.lessonsDone.includes(lessonId) ? up.lessonsDone : [...up.lessonsDone, lessonId];
    const unit = allUnits().find((u) => u.id === unitId);
    const allDone = unit ? unit.lessons.every((l) => lessonsDone.includes(l.id)) : false;
    const upNext: UnitProgressRow = {
      ...up,
      lessonsDone,
      completedAt: up.completedAt ?? (allDone ? new Date().toISOString() : null),
    };
    await db.transaction('rw', [db.lessonProgress, db.unitProgress], async () => {
      await db.lessonProgress.put(row);
      await db.unitProgress.put(upNext);
    });
    set({
      lessonProgress: { ...get().lessonProgress, [id]: row },
      unitProgress: { ...get().unitProgress, [unitId]: upNext },
    });
  },

  async completeDialogue(unitId) {
    const up: UnitProgressRow = get().unitProgress[unitId] ?? {
      unitId,
      lessonsDone: [],
      dialogueDone: false,
      completedAt: null,
    };
    const next = { ...up, dialogueDone: true };
    await db.unitProgress.put(next);
    set({ unitProgress: { ...get().unitProgress, [unitId]: next } });
  },

  async saveReminders(rows) {
    await db.reminders.clear();
    await db.reminders.bulkAdd(rows as ReminderRow[]);
    const reminders = await db.reminders.toArray();
    set({ reminders });
    await platform.setReminders(reminders.map(({ hh, mm, enabled, label }) => ({ hh, mm, enabled, label })));
  },

  async exportBackupJson() {
    return JSON.stringify(await exportAll(), null, 2);
  },

  async importBackupJson(json) {
    await importAll(JSON.parse(json));
    await get().init(); // re-hydrate; view is preserved for loaded sessions
  },
}));

// ---- selectors ----

export function useStreakStanding(): { standing: StreakStanding; count: number } {
  const streak = useApp((s) => s.streak);
  const profile = useApp((s) => s.profile);
  const day = today(profile);
  return { standing: standing(streak, day), count: displayCount(streak, day) };
}

export function useDailyGoal(): { goal: number; earned: number; pct: number } {
  const profile = useApp((s) => s.profile);
  const todayXp = useApp((s) => s.todayXp);
  const goal = DAILY_GOAL_XP[profile?.difficulty ?? 'standard'];
  return { goal, earned: todayXp, pct: Math.min(1, todayXp / goal) };
}

export function useDueCount(): number {
  const cards = useApp((s) => s.srsCards);
  return dueCards(Object.values(cards), new Date()).length;
}

/**
 * Unit availability: everything before the placement start section is open;
 * from there units unlock sequentially as the previous unit's lessons finish.
 */
export function useUnitStatus(): (unitId: string) => 'locked' | 'active' | 'done' {
  const profile = useApp((s) => s.profile);
  const unitProgress = useApp((s) => s.unitProgress);
  const units = allUnits();
  return (unitId: string) => {
    const unit = units.find((u) => u.id === unitId);
    if (!unit) return 'locked';
    // each track unlocks independently and sequentially
    const inTrack = units.filter((u) => u.track === unit.track);
    const idx = inTrack.findIndex((u) => u.id === unitId);
    const up = unitProgress[unitId];
    const isComplete = up ? unit.lessons.every((l) => up.lessonsDone.includes(l.id)) : false;
    if (isComplete) return 'done';
    // placement start-section applies to the speaking track only
    const startSection = unit.track === 'speak' ? (profile?.startSection ?? 1) : 1;
    if (unit.section < startSection) return 'active'; // pre-placement content stays open
    const prev = inTrack[idx - 1];
    if (!prev) return 'active';
    if (prev.section < startSection) return 'active'; // first unit at the start section
    const prevUp = unitProgress[prev.id];
    const prevDone = prevUp ? prev.lessons.every((l) => prevUp.lessonsDone.includes(l.id)) : false;
    return prevDone ? 'active' : 'locked';
  };
}
