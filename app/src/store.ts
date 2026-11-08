// Central app state (zustand). Hydrates from Dexie once at boot; every
// mutation persists back inside the action. UI components never touch db.

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { db, type LessonProgressRow, type ProfileRow, type ReminderRow, type StreakRow, type UnitProgressRow } from './db/schema';
import { exportAll, importAll } from './db/backup';
import { emptyStreak, grantFreeze, localDay, recordActivity, standing, displayCount } from './engine/streak';
import { freezesEarned, DAILY_GOAL_XP } from './engine/xp';
import { newCard, reviewCard, dueCards, type StoredCard, Rating } from './engine/srs';
import type { Difficulty, ScriptMode, StreakStanding } from './engine/types';
import { allUnits } from './content/load';
import { DEFAULT_VOICE, type VoiceId } from './content/voices';
import { setActiveVoice } from './audio';
import { platform } from './platform';
import { balance, COINS, earnedTotal, MILESTONES, ownedSkus, skuById, type CoinEvent, type CoinKind } from './engine/coins';
import { bump, claim, dailyQuests, isComplete, type Quest, type QuestKind } from './engine/quests';
import { evaluateBadges, newlyEarned, reconcileBadges, type BadgeRow, type BadgeStats } from './engine/badges';
import type { LessonRewards } from './engine/rewards';
import { ratingForOutcome, REWARDED_ROUNDS_PER_DAY, roundCoins, roundXp, type GameId, type RoundResult } from './engine/games';
import type { Session } from './auth';

export type View =
  | { name: 'onboarding' }
  | { name: 'placement' }
  | { name: 'path' }
  | { name: 'lesson'; unitId: string; lessonId: string }
  | { name: 'dialogue'; unitId: string }
  | { name: 'play' }
  | { name: 'game'; game: GameId }
  | { name: 'profile' }
  | { name: 'settings' }
  | { name: 'quests' }
  | { name: 'shop' }
  | { name: 'badges' }
  | { name: 'auth'; mode?: 'signin' | 'create' | 'recover' };

export interface GameRewards {
  xp: number;
  coins: number;
  /** false once the day's rewarded rounds are used up — the round still counts */
  rewarded: boolean;
  roundsToday: number;
  award: XpAward;
  questsCompleted: Quest[];
  badgesEarned: BadgeRow[];
}

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
  /** coin ledger (synced); balance and ownership are derived */
  coinEvents: CoinEvent[];
  coins: number;
  ownedSkus: Set<string>;
  /** today's quests */
  quests: Quest[];
  badges: BadgeRow[];
  /** game rounds played (and, historically, flashcards reviewed) */
  reviewCount: number;
  session: Session | null;

  navigate(view: View): void;
  setSession(s: Session | null): void;
  grantCoins(delta: number, kind: CoinKind, refId: string): Promise<void>;
  spendCoins(skuId: string): Promise<boolean>;
  equip(kind: 'outfit' | 'accent', skuId: string | null): Promise<void>;
  bumpQuest(kind: QuestKind, n: number): Promise<Quest[]>;
  claimQuest(id: string): Promise<number>;
  refreshBadges(): Promise<BadgeRow[]>;
  recordSpeak(): Promise<void>;
  finishLesson(unitId: string, lessonId: string, pct: number, xp: number): Promise<LessonRewards>;
  init(): Promise<void>;
  createProfile(name: string, difficulty: Difficulty): Promise<void>;
  finishPlacement(startSection: number): Promise<void>;
  skipPlacement(): Promise<void>;
  setDifficulty(d: Difficulty): Promise<void>;
  setScriptMode(m: ScriptMode): Promise<void>;
  setSoundOn(on: boolean): Promise<void>;
  setVoice(v: VoiceId): Promise<void>;
  awardXp(amount: number, source: 'lesson' | 'review' | 'speak' | 'dialogue' | 'placement' | 'bonus' | 'game', refId: string): Promise<XpAward>;
  finishGameRound(result: RoundResult): Promise<GameRewards>;
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
  coinEvents: [],
  coins: 0,
  ownedSkus: new Set(),
  quests: [],
  badges: [],
  reviewCount: 0,
  session: null,

  navigate(view) {
    set({ view });
    window.scrollTo(0, 0);
  },

  setSession(session) {
    set({ session });
  },

  async grantCoins(delta, kind, refId) {
    const day = today(get().profile);
    const ev: CoinEvent = { ts: new Date().toISOString(), day, delta, kind, refId };
    const id = await db.coinEvents.add(ev);
    const coinEvents = [...get().coinEvents, { ...ev, id }];
    set({ coinEvents, coins: balance(coinEvents), ownedSkus: ownedSkus(coinEvents) });
    void import('./sync').then(({ sync }) => sync.requestSync());
  },

  async spendCoins(skuId) {
    const sku = skuById(skuId);
    const state = get();
    if (!sku || state.coins < sku.price) return false;
    if (!sku.consumable && state.ownedSkus.has(sku.id)) return false;
    if (sku.id === 'freeze') {
      const next = grantFreeze(state.streak, 1);
      if (next.freezesOwned === state.streak.freezesOwned) return false; // already holding the max
      const streak: StreakRow = { id: 'main', ...next };
      await db.streaks.put(streak);
      set({ streak });
    }
    await get().grantCoins(-sku.price, 'spend', sku.id);
    if (sku.kind === 'outfit' || sku.kind === 'accent') await get().equip(sku.kind, sku.id);
    return true;
  },

  async equip(kind, skuId) {
    const profile = get().profile;
    if (!profile) return;
    const next: ProfileRow = { ...profile, [kind]: skuId ?? undefined };
    await db.profile.put(next);
    set({ profile: next });
    void import('./sync').then(({ sync }) => sync.requestSync());
  },

  async bumpQuest(kind, n) {
    const before = get().quests;
    const completed: Quest[] = [];
    const after = before.map((q) => {
      if (q.kind !== kind) return q;
      const next = bump(q, n);
      if (!isComplete(q) && isComplete(next)) completed.push(next);
      return next;
    });
    if (after.some((q, i) => q !== before[i])) {
      await db.quests.bulkPut(after);
      set({ quests: after });
    }
    return completed;
  },

  async claimQuest(id) {
    const q = get().quests.find((x) => x.id === id);
    if (!q) return 0;
    const claimed = claim(q);
    if (claimed === q || claimed.reward === null) return 0;
    await db.quests.put(claimed);
    set({ quests: get().quests.map((x) => (x.id === id ? claimed : x)) });
    await get().grantCoins(claimed.reward, 'quest', id);
    return claimed.reward;
  },

  async refreshBadges() {
    const state = get();
    const stats = badgeStats(state);
    const next = reconcileBadges(state.badges, evaluateBadges(stats));
    const fresh = newlyEarned(state.badges, next);
    if (fresh.length > 0) {
      await db.badges.bulkPut(next);
      set({ badges: next });
      for (const b of fresh) await get().grantCoins(COINS.badge, 'badge', `${b.id}:${b.tier}`);
    }
    return fresh;
  },

  async recordSpeak() {
    await get().bumpQuest('speak', 1);
  },

  async finishLesson(unitId, lessonId, pct, xp) {
    const award = await get().awardXp(xp, 'lesson', `${unitId}:${lessonId}`);
    await get().completeLesson(unitId, lessonId, pct, xp);
    const ref = `${unitId}:${lessonId}`;
    const perfect = pct >= 1;
    const milestone = award.streakExtended && MILESTONES[award.streakCount] ? award.streakCount : null;
    const coins = {
      lesson: COINS.lesson,
      perfect: perfect ? COINS.perfectBonus : 0,
      goal: award.goalJustReached ? COINS.goal : 0,
      milestone: milestone ? MILESTONES[milestone] : 0,
      total: 0,
    };
    coins.total = coins.lesson + coins.perfect + coins.goal + coins.milestone;
    await get().grantCoins(coins.lesson, 'lesson', ref);
    if (coins.perfect) await get().grantCoins(coins.perfect, 'perfect', ref);
    if (coins.goal) await get().grantCoins(coins.goal, 'goal', today(get().profile));
    if (coins.milestone) await get().grantCoins(coins.milestone, 'milestone', `streak:${milestone}`);
    const questsCompleted = [
      ...(await get().bumpQuest('lessons', 1)),
      ...(perfect ? await get().bumpQuest('perfect', 1) : []),
      ...(await get().bumpQuest('earn-xp', 0)), // no-op bump reports nothing; earn-xp is bumped in awardXp
    ];
    const badgesEarned = await get().refreshBadges();
    return { award, coins, milestone, questsCompleted, badgesEarned };
  },

  async init() {
    const profile = (await db.profile.get('main')) ?? null;
    setActiveVoice(profile?.voice ?? DEFAULT_VOICE);
    const streak = (await db.streaks.get('main')) ?? { id: 'main', ...emptyStreak() };
    const unitProgress = Object.fromEntries((await db.unitProgress.toArray()).map((r) => [r.unitId, r]));
    const lessonProgress = Object.fromEntries((await db.lessonProgress.toArray()).map((r) => [r.id, r]));
    const srsCards = Object.fromEntries((await db.srsCards.toArray()).map((r) => [r.id, r]));
    const reminders = await db.reminders.toArray();
    const events = await db.xpEvents.toArray();
    const totalXp = events.reduce((s, e) => s + e.amount, 0);
    const day = today(profile);
    const todayXp = events.filter((e) => e.day === day).reduce((s, e) => s + e.amount, 0);
    const reviewCount = events.filter((e) => e.source === 'review' || e.source === 'game').length;
    const coinEvents = await db.coinEvents.toArray();
    let quests = await db.quests.where('day').equals(day).toArray();
    if (quests.length === 0) {
      quests = dailyQuests(day);
      await db.quests.bulkPut(quests);
    }
    const badges = await db.badges.toArray();
    const sess = await db.settings.bulkGet(['syncAuthToken', 'syncAuthEmail', 'syncAuthSlot']);
    const [token, email, slot] = sess.map((r) => r?.value as string | undefined);
    const session = token && email && slot ? { token, email, slot } : null;
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
      reviewCount,
      coinEvents,
      coins: balance(coinEvents),
      ownedSkus: ownedSkus(coinEvents),
      quests,
      badges,
      session,
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
      startSection: 0,
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
    const profile = { ...get().profile!, placementDone: true, startSection: 0 };
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

  async setVoice(voice) {
    const profile = { ...get().profile!, voice };
    await db.profile.put(profile);
    setActiveVoice(voice);
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
    set({ streak, totalXp, todayXp, reviewCount: state.reviewCount + (source === 'review' || source === 'game' ? 1 : 0) });
    if (amount > 0) await get().bumpQuest('earn-xp', amount);
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

  async finishGameRound(result) {
    const day = today(get().profile);
    // the round is recorded as an XP event even when it pays nothing, so the
    // day's count and the badge stat see every round
    const played = (await db.xpEvents.toArray()).filter((e) => e.source === 'game' && e.day === day).length;
    const rewarded = played < REWARDED_ROUNDS_PER_DAY;
    for (const o of result.outcomes) {
      if (get().srsCards[o.itemId]) await get().applyReview(o.itemId, ratingForOutcome(o));
    }
    const ref = `${result.game}:${new Date().toISOString()}`;
    const xp = rewarded ? roundXp(result) : 0;
    const coins = rewarded ? roundCoins(result) : 0;
    const award = await get().awardXp(xp, 'game', ref);
    if (coins > 0) await get().grantCoins(coins, 'game', ref);
    const questsCompleted = await get().bumpQuest('review', 1);
    const badgesEarned = await get().refreshBadges();
    return { xp, coins, rewarded, roundsToday: played + 1, award, questsCompleted, badgesEarned };
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

function badgeStats(state: AppState): BadgeStats {
  const units = allUnits();
  return {
    lessons: Object.values(state.lessonProgress).reduce((s, r) => s + r.attempts, 0),
    perfectLessons: state.coinEvents.filter((e) => e.kind === 'perfect').length,
    longestStreak: state.streak.longest,
    totalXp: state.totalXp,
    reviews: state.reviewCount,
    cards: Object.keys(state.srsCards).length,
    coinsEarned: earnedTotal(state.coinEvents),
    unitsDone: units.filter((u) => {
      const up = state.unitProgress[u.id];
      return up && u.lessons.every((l) => up.lessonsDone.includes(l.id));
    }).length,
  };
}

export function useBadgeStats(): BadgeStats {
  // the stats object is rebuilt per call; shallow-compare so React only re-renders on real change
  return useApp(useShallow(badgeStats));
}

// the shop's accent theme is a document attribute so CSS tokens can swap
useApp.subscribe((state, prev) => {
  if (state.profile?.accent !== prev.profile?.accent) {
    const accent = state.profile?.accent;
    if (accent) document.documentElement.dataset.accent = accent;
    else delete document.documentElement.dataset.accent;
  }
});

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
