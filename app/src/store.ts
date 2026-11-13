// Central app state (zustand). Hydrates from Dexie once at boot; every
// mutation persists back inside the action. UI components never touch db.

import { DEV_COINS, DEV_TEST } from './devMode';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { db, type LessonProgressRow, type ProfileRow, type ReminderRow, type StreakRow, type UnitProgressRow } from './db/schema';
import { exportAll, importAll } from './db/backup';
import { canBuyFreeze, dayDiff, deviceTimeZone, emptyStreak, grantFreeze, localDay, recordActivity, standing, displayCount } from './engine/streak';
import { freezesEarned, DAILY_GOAL_XP } from './engine/xp';
import { newCard, reviewCard, type StoredCard, Rating } from './engine/srs';
import type { Difficulty, ScriptMode, StreakStanding } from './engine/types';
import { allUnits } from './content/load';
import { DEFAULT_VOICE, type VoiceId } from './content/voices';
import { setActiveVoice, setSfxEnabled } from './audio';
import { platform } from './platform';
import { balance, COINS, earnedTotal, FREEZE_SKU, goalBonusDue, milestoneBonusDue, ownedSkus, skuById, type CoinEvent, type CoinKind } from './engine/coins';
import { bump, claim, dailyQuests, isComplete, type Quest, type QuestKind } from './engine/quests';
import { evaluateBadges, newlyEarned, reconcileBadges, type BadgeRow, type BadgeStats } from './engine/badges';
import type { LessonRewards } from './engine/rewards';
import { gamePool, learnedCount, ratingForOutcome, REWARDED_ROUNDS_PER_DAY, roundCoins, roundCounts, roundXp, type GameId, type RoundResult } from './engine/games';
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

export type PathTrack = 'speak' | 'script';

export interface GameRewards {
  xp: number;
  /** everything this round added to the balance: the round's own coins plus any goal / streak bonus it triggered */
  coins: number;
  /** part of `coins`: the daily-goal bonus, when this round crossed the goal */
  goalCoins: number;
  /** part of `coins`: the streak-milestone bonus, when this round took the streak to a milestone day */
  milestoneCoins: number;
  /** false once the day's full-pay rounds are used up — the round still pays a few coins */
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
  /** freezes actually added by this award (0 when already holding the maximum) */
  freezesEarnedNow: number;
  freezesConsumed: number;
  goalJustReached: boolean;
  /** coins paid by this award for reaching the daily goal (once per day) */
  goalCoins: number;
  /** streak milestone (3, 7, 14…) this award reached and paid for, if any */
  milestone: number | null;
  milestoneCoins: number;
}

interface AppState {
  loaded: boolean;
  view: View;
  profile: ProfileRow | null;
  streak: StreakRow;
  totalXp: number;
  todayXp: number;
  /** the local day `todayXp` and `quests` belong to */
  day: string;
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
  /** which course the home path shows; remembered on this device only, never synced */
  pathTrack: PathTrack;

  navigate(view: View): void;
  setPathTrack(track: PathTrack): void;
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
  /** Midnight passed while the app stayed open: start the new day's XP count and quests. */
  rollDay(): Promise<void>;
  introduceItems(itemIds: string[]): Promise<void>;
  applyReview(itemId: string, rating: Rating): Promise<void>;
  completeLesson(unitId: string, lessonId: string, pct: number, xp: number): Promise<void>;
  completeDialogue(unitId: string): Promise<void>;
  saveReminders(rows: Omit<ReminderRow, 'id'>[]): Promise<void>;
  exportBackupJson(): Promise<string>;
  importBackupJson(json: string): Promise<void>;
}

/**
 * The learner's calendar day: always this device's current timezone.
 * (`profile.timezone` is synced and was only ever written at sign-up, so the
 * day rolled at the wrong hour after travel, or on a second device elsewhere.)
 */
function today(): string {
  return localDay(new Date(), deviceTimeZone());
}

// The path's selected course is a device-local convenience: it lives in
// localStorage, outside the synced/backed-up tables, so it survives a reload
// without ever travelling to another device as "progress".
const PATH_TRACK_KEY = 'chilaka.pathTrack';
function readPathTrack(): PathTrack {
  try {
    return globalThis.localStorage?.getItem(PATH_TRACK_KEY) === 'script' ? 'script' : 'speak';
  } catch {
    return 'speak';
  }
}

// in-flight guards: a double tap must not run a paying action twice
let spending = false;
let claiming = false;
let badgeQueue: Promise<unknown> = Promise.resolve();

export const useApp = create<AppState>((set, get) => ({
  loaded: false,
  view: { name: 'path' },
  profile: null,
  streak: { id: 'main', ...emptyStreak() },
  totalXp: 0,
  todayXp: 0,
  day: '',
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
  pathTrack: readPathTrack(),

  setPathTrack(pathTrack) {
    set({ pathTrack });
    try {
      globalThis.localStorage?.setItem(PATH_TRACK_KEY, pathTrack);
    } catch {
      // private mode / storage blocked: the choice still holds for this session
    }
  },

  navigate(view) {
    set({ view });
    window.scrollTo(0, 0);
  },

  setSession(session) {
    set({ session });
  },

  async grantCoins(delta, kind, refId) {
    const day = today();
    const ev: CoinEvent = { ts: new Date().toISOString(), day, delta, kind, refId };
    const id = await db.coinEvents.add(ev);
    const coinEvents = [...get().coinEvents, { ...ev, id }];
    set({ coinEvents, coins: balance(coinEvents), ownedSkus: ownedSkus(coinEvents) });
    void import('./sync').then(({ sync }) => sync.requestSync());
  },

  async spendCoins(skuId) {
    // one purchase at a time: a double tap must not pass the balance check twice
    if (spending) return false;
    spending = true;
    try {
      const sku = skuById(skuId);
      const state = get();
      if (!sku || state.coins < sku.price) return false;
      if (!sku.consumable && state.ownedSkus.has(sku.id)) return false;
      if (sku.id === FREEZE_SKU) {
        // refused at the cap, and while the streak is already broken: a freeze
        // protects days ahead, it must not repair a streak after the fact
        if (canBuyFreeze(state.streak, today()) !== 'ok') return false;
        // ledger first: the spend event is what tells every device (and the
        // sync merge) that this freeze exists
        await get().grantCoins(-sku.price, 'spend', sku.id);
        const streak: StreakRow = { id: 'main', ...grantFreeze(get().streak, 1) };
        await db.streaks.put(streak);
        set({ streak });
        return true;
      }
      await get().grantCoins(-sku.price, 'spend', sku.id);
      if (sku.kind === 'outfit' || sku.kind === 'accent') await get().equip(sku.kind, sku.id);
      return true;
    } finally {
      spending = false;
    }
  },

  async equip(kind, skuId) {
    const profile = get().profile;
    if (!profile) return;
    const next: ProfileRow = { ...profile, [kind]: skuId ?? undefined };
    await db.profile.put(next);
    set({ profile: next });
    void import('./sync').then(({ sync }) => sync.requestSync());
  },

  async rollDay() {
    const state = get();
    if (!state.loaded) return;
    const day = today();
    if (day === state.day) return;
    const todayXp = (await db.xpEvents.where('day').equals(day).toArray()).reduce((sum, e) => sum + e.amount, 0);
    let quests = await db.quests.where('day').equals(day).toArray();
    if (quests.length === 0) {
      quests = dailyQuests(day);
      await db.quests.bulkPut(quests);
    }
    set({ day, todayXp, quests });
  },

  async bumpQuest(kind, n) {
    await get().rollDay();
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
    // one claim at a time: a double tap must not open the same chest twice
    if (claiming) return 0;
    claiming = true;
    try {
      const q = get().quests.find((x) => x.id === id);
      if (!q) return 0;
      const claimed = claim(q);
      if (claimed === q || claimed.reward === null) return 0;
      await db.quests.put(claimed);
      set({ quests: get().quests.map((x) => (x.id === id ? claimed : x)) });
      await get().grantCoins(claimed.reward, 'quest', id);
      return claimed.reward;
    } finally {
      claiming = false;
    }
  },

  refreshBadges() {
    // runs one after another: an overlapping call waits and then sees the
    // badges the first one stored, so no tier is paid for twice
    const run = async (): Promise<BadgeRow[]> => {
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
    };
    const result = badgeQueue.then(run, run);
    badgeQueue = result.catch(() => undefined);
    return result;
  },

  async recordSpeak() {
    await get().bumpQuest('speak', 1);
  },

  async finishLesson(unitId, lessonId, pct, xp) {
    const award = await get().awardXp(xp, 'lesson', `${unitId}:${lessonId}`);
    await get().completeLesson(unitId, lessonId, pct, xp);
    const ref = `${unitId}:${lessonId}`;
    const perfect = pct >= 1;
    // the goal and streak-milestone bonuses were already paid by awardXp
    // (any XP source can trigger them); here they are only reported
    const milestone = award.milestone;
    const coins = {
      lesson: COINS.lesson,
      perfect: perfect ? COINS.perfectBonus : 0,
      goal: award.goalCoins,
      milestone: award.milestoneCoins,
      total: 0,
    };
    coins.total = coins.lesson + coins.perfect + coins.goal + coins.milestone;
    await get().grantCoins(coins.lesson, 'lesson', ref);
    if (coins.perfect) await get().grantCoins(coins.perfect, 'perfect', ref);
    const questsCompleted = [
      ...(await get().bumpQuest('lessons', 1)),
      ...(perfect ? await get().bumpQuest('perfect', 1) : []),
      ...(await get().bumpQuest('earn-xp', 0)), // no-op bump reports nothing; earn-xp is bumped in awardXp
    ];
    const badgesEarned = await get().refreshBadges();
    return { award, coins, milestone, questsCompleted, badgesEarned };
  },

  async init() {
    let profile = (await db.profile.get('main')) ?? null;
    setActiveVoice(profile?.voice ?? DEFAULT_VOICE);
    if (DEV_TEST && (!profile || !profile.onboarded || !profile.placementDone)) {
      // developer version: no name or level set-up, straight to the path
      profile = {
        id: 'main',
        name: 'Tester',
        createdAt: new Date().toISOString(),
        difficulty: 'standard',
        scriptMode: 'roman+telugu',
        timezone: deviceTimeZone(),
        soundOn: true,
        ...profile,
        onboarded: true,
        placementDone: true,
        startSection: profile?.startSection ?? 0,
      } as ProfileRow;
      await db.profile.put(profile);
    }
    setSfxEnabled(profile?.soundOn !== false);
    let streak = (await db.streaks.get('main')) ?? { id: 'main', ...emptyStreak() };
    const unitProgress = Object.fromEntries((await db.unitProgress.toArray()).map((r) => [r.unitId, r]));
    const lessonProgress = Object.fromEntries((await db.lessonProgress.toArray()).map((r) => [r.id, r]));
    const srsCards = Object.fromEntries((await db.srsCards.toArray()).map((r) => [r.id, r]));
    const reminders = await db.reminders.toArray();
    const events = await db.xpEvents.toArray();
    const totalXp = events.reduce((s, e) => s + e.amount, 0);
    const wasLoaded = get().loaded;
    // The device moved to another timezone (or the profile came from one):
    // days are now counted on this device's calendar. Re-read the last active
    // day on that calendar too, so the move itself can neither skip a day
    // (breaking the streak after flying east) nor hand out a free one. Only
    // at app start — a sync landing mid-session must not make two devices in
    // different timezones rewrite the profile at each other.
    const tz = deviceTimeZone();
    if (!wasLoaded && profile && profile.timezone !== tz) {
      const lastTs = events.reduce((m, e) => (e.ts > m ? e.ts : m), '');
      if (streak.lastActiveDay && lastTs) {
        const anchored = localDay(new Date(lastTs), tz);
        if (anchored !== streak.lastActiveDay && Math.abs(dayDiff(streak.lastActiveDay, anchored)) === 1) {
          streak = { ...streak, lastActiveDay: anchored };
          await db.streaks.put(streak);
        }
      }
      profile = { ...profile, timezone: tz };
      await db.profile.put(profile);
    }
    const day = today();
    const todayXp = events.filter((e) => e.day === day).reduce((s, e) => s + e.amount, 0);
    const reviewCount = events.filter((e) => e.source === 'review' || e.source === 'game').length;
    let coinEvents = await db.coinEvents.toArray();
    if (DEV_TEST && balance(coinEvents) < DEV_COINS) {
      // developer version: enough coins to try everything in the shop
      const ev: CoinEvent = { ts: new Date().toISOString(), day, delta: DEV_COINS - balance(coinEvents), kind: 'badge', refId: 'dev-tester' };
      const id = await db.coinEvents.add(ev);
      coinEvents = [...coinEvents, { ...ev, id }];
    }
    let quests = await db.quests.where('day').equals(day).toArray();
    if (quests.length === 0) {
      quests = dailyQuests(day);
      await db.quests.bulkPut(quests);
    }
    const badges = await db.badges.toArray();
    const sess = await db.settings.bulkGet(['syncAuthToken', 'syncAuthEmail', 'syncAuthSlot']);
    const [token, email, slot] = sess.map((r) => r?.value as string | undefined);
    const session = token && email && slot ? { token, email, slot } : null;
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
      day,
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
      timezone: deviceTimeZone(),
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
    setSfxEnabled(soundOn);
    await db.profile.put(profile);
    set({ profile });
  },

  async awardXp(amount, source, refId) {
    await get().rollDay();
    const state = get();
    const day = today();
    const prevTotal = state.totalXp;
    const goalBefore = state.todayXp >= DAILY_GOAL_XP[state.profile?.difficulty ?? 'standard'];

    const upd = recordActivity(state.streak, day);
    let streakState = upd.state;
    const crossed = freezesEarned(prevTotal, prevTotal + amount);
    const heldBefore = streakState.freezesOwned;
    if (crossed > 0) streakState = grantFreeze(streakState, crossed);
    // what was really added: nothing when the learner already holds the maximum
    const earned = streakState.freezesOwned - heldBefore;
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
    const goalJustReached = goalNow && !goalBefore;
    // Goal and streak-milestone coins belong to the XP that triggered them,
    // whatever earned it (lesson, game, dialogue). The coin ledger is the
    // guard: once per day for the goal, once per milestone day.
    const goalCoins = goalJustReached ? goalBonusDue(get().coinEvents, day) : 0;
    if (goalCoins > 0) await get().grantCoins(goalCoins, 'goal', day);
    const milestoneCoins = upd.extended ? milestoneBonusDue(get().coinEvents, streak.current, day) : 0;
    if (milestoneCoins > 0) await get().grantCoins(milestoneCoins, 'milestone', `streak:${streak.current}`);
    return {
      amount,
      streakExtended: upd.extended,
      streakCount: streak.current,
      freezesEarnedNow: earned,
      freezesConsumed: upd.freezesConsumed,
      goalJustReached,
      goalCoins,
      milestone: milestoneCoins > 0 ? streak.current : null,
      milestoneCoins,
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
    const day = today();
    // the round is recorded as an XP event even when it pays no XP, so the
    // day's count and the badge stat see every round
    const played = (await db.xpEvents.toArray()).filter((e) => e.source === 'game' && e.day === day).length;
    const rewarded = played < REWARDED_ROUNDS_PER_DAY;
    for (const o of result.outcomes) {
      if (get().srsCards[o.itemId]) await get().applyReview(o.itemId, ratingForOutcome(o));
    }
    if (!roundCounts(result)) {
      // nothing was solved (the clock ran out untouched): not a round played.
      // No XP event, so no streak day, no quest or badge progress, and none of
      // the day's full-pay rounds is used up.
      const idle: XpAward = {
        amount: 0,
        streakExtended: false,
        streakCount: get().streak.current,
        freezesEarnedNow: 0,
        freezesConsumed: 0,
        goalJustReached: false,
        goalCoins: 0,
        milestone: null,
        milestoneCoins: 0,
      };
      return { xp: 0, coins: 0, goalCoins: 0, milestoneCoins: 0, rewarded, roundsToday: played, award: idle, questsCompleted: [], badgesEarned: [] };
    }
    const ref = `${result.game}:${new Date().toISOString()}`;
    const xp = rewarded ? roundXp(result) : 0;
    const roundPay = roundCoins(result, rewarded);
    const award = await get().awardXp(xp, 'game', ref);
    if (roundPay > 0) await get().grantCoins(roundPay, 'game', ref);
    const questsCompleted = await get().bumpQuest('review', 1);
    const badgesEarned = await get().refreshBadges();
    return {
      xp,
      coins: roundPay + award.goalCoins + award.milestoneCoins,
      goalCoins: award.goalCoins,
      milestoneCoins: award.milestoneCoins,
      rewarded,
      roundsToday: played + 1,
      award,
      questsCompleted,
      badgesEarned,
    };
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
    // only phrases that still exist: cards of ids retired by a content update are not "learned"
    cards: learnedCount(state.srsCards),
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
  const day = today();
  return { standing: standing(streak, day), count: displayCount(streak, day) };
}

export function useDailyGoal(): { goal: number; earned: number; pct: number } {
  const profile = useApp((s) => s.profile);
  const todayXp = useApp((s) => s.todayXp);
  const goal = DAILY_GOAL_XP[profile?.difficulty ?? 'standard'];
  return { goal, earned: todayXp, pct: Math.min(1, todayXp / goal) };
}

/**
 * Phrases waiting for a round — only the ones a game can actually deal.
 * (Counting every due card left the badge stuck: cards of retired ids and
 * of sentences too long for a tile are never dealt, so they never clear.)
 */
export function useDueCount(): number {
  const cards = useApp((s) => s.srsCards);
  return gamePool(cards).dueIds.length;
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
