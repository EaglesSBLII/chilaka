// Adaptive placement test: a staircase over difficulty tiers 1..5.
// Answers drive the tier up/down; two wrong answers at a tier settles the
// learner below it. Result maps to a starting section.

export interface PlacementQuestionRef {
  itemId: string;
  tier: 1 | 2 | 3 | 4 | 5;
}

export interface PlacementState {
  asked: { itemId: string; tier: number; correct: boolean }[];
  tier: number; // current tier being probed
  done: boolean;
  resultTier: number | null; // settled tier (0 = complete beginner)
}

export const PLACEMENT_MAX_QUESTIONS = 18;
export const PLACEMENT_START_TIER = 2; // advanced-beginner default entry

export function startPlacement(): PlacementState {
  return { asked: [], tier: PLACEMENT_START_TIER, done: false, resultTier: null };
}

function wrongsAt(state: PlacementState, tier: number): number {
  return state.asked.filter((a) => a.tier === tier && !a.correct).length;
}

function correctAt(state: PlacementState, tier: number): number {
  return state.asked.filter((a) => a.tier === tier && a.correct).length;
}

/** Apply an answer; returns the next state (possibly done). */
export function answerPlacement(state: PlacementState, itemId: string, correct: boolean): PlacementState {
  const s: PlacementState = {
    ...state,
    asked: [...state.asked, { itemId, tier: state.tier, correct }],
  };

  if (wrongsAt(s, s.tier) >= 2) {
    // failed this tier twice → settle at the highest tier with 2+ correct
    s.done = true;
    s.resultTier = highestPassedTier(s);
    return s;
  }
  if (correctAt(s, s.tier) >= 2) {
    if (s.tier >= 5) {
      s.done = true;
      s.resultTier = 5;
      return s;
    }
    s.tier += 1;
  } else if (!correct && s.tier > 1) {
    s.tier -= 1;
  }
  if (s.asked.length >= PLACEMENT_MAX_QUESTIONS) {
    s.done = true;
    s.resultTier = highestPassedTier(s);
  }
  return s;
}

function highestPassedTier(state: PlacementState): number {
  for (let t = 5; t >= 1; t--) {
    if (correctAt(state, t) >= 2 && wrongsAt(state, t) < 2) return t;
  }
  // never passed a tier: tier 1 attempted and failed → start at the very top
  return 0;
}

/**
 * Starting section for a settled tier. Tier 0 → section 0 (start of course);
 * tier n → section where that difficulty begins. With 8 sections and 5 tiers,
 * tiers map to sections [1,2,4,6,7]→ pass tier t means content of tier t is
 * comfortable, so start one section past it.
 */
export const TIER_TO_START_SECTION: Record<number, number> = {
  0: 0,
  1: 2,
  2: 3,
  3: 5,
  4: 7,
  5: 8,
};

export function startSectionForTier(tier: number): number {
  return TIER_TO_START_SECTION[tier] ?? 1;
}

/** Pick the next question item id from the bank for the current tier. */
export function nextPlacementItem(state: PlacementState, bank: PlacementQuestionRef[]): string | null {
  const askedIds = new Set(state.asked.map((a) => a.itemId));
  const candidates = bank.filter((q) => q.tier === state.tier && !askedIds.has(q.itemId));
  if (candidates.length > 0) return candidates[0].itemId;
  // tier bank exhausted — any unasked question, nearest tier first
  const remaining = bank
    .filter((q) => !askedIds.has(q.itemId))
    .sort((a, b) => Math.abs(a.tier - state.tier) - Math.abs(b.tier - state.tier));
  return remaining.length > 0 ? remaining[0].itemId : null;
}
