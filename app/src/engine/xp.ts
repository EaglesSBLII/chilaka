// XP economy, levels, daily goals, freeze earning. Pure functions.

import type { Difficulty, ExerciseKind } from './types';

export const DAILY_GOAL_XP: Record<Difficulty, number> = {
  relaxed: 20,
  standard: 35,
  intense: 50,
};

export const FREEZE_EARN_XP = 300; // one streak freeze per 300 lifetime XP

/** XP for one answered exercise. */
export function xpForExercise(kind: ExerciseKind, correct: boolean): number {
  if (kind === 'intro') return 0;
  if (!correct) return 0;
  switch (kind) {
    case 'speak':
      return 4;
    case 'dialogue':
      return 4;
    case 'wordbank':
      return 3;
    case 'type-script':
      return 3;
    default:
      return 2;
  }
}

/** Bonus on completing a lesson, scaled by accuracy (0..1). */
export function lessonCompletionBonus(accuracy: number): number {
  if (accuracy >= 1) return 10; // perfect lesson
  if (accuracy >= 0.9) return 7;
  if (accuracy >= 0.75) return 5;
  return 3;
}

export function xpForReviewCard(correct: boolean): number {
  return correct ? 2 : 1; // reviewing at all keeps you warm
}

// Levels: Telugu-flavored rank ladder. Thresholds are cumulative lifetime XP.
export interface LevelDef {
  level: number;
  name: string;
  teName: string;
  minXp: number;
}

export const LEVELS: LevelDef[] = [
  { level: 1, name: 'Little Parrot', teName: 'చిన్ని చిలక', minXp: 0 },
  { level: 2, name: 'Student', teName: 'శిష్యుడు', minXp: 100 },
  { level: 3, name: 'Friend', teName: 'నేస్తం', minXp: 300 },
  { level: 4, name: 'Talker', teName: 'మాటకారి', minXp: 700 },
  { level: 5, name: 'Storyteller', teName: 'కబుర్ల రాజు', minXp: 1300 },
  { level: 6, name: 'Telugu Kid', teName: 'తెలుగు బిడ్డ', minXp: 2200 },
  { level: 7, name: 'Great Speaker', teName: 'మహా వక్త', minXp: 3500 },
  { level: 8, name: 'Language Hero', teName: 'భాషా వీరుడు', minXp: 5200 },
  { level: 9, name: 'Parrot Guru', teName: 'చిలక గురువు', minXp: 7500 },
  { level: 10, name: 'Telugu Tiger', teName: 'తెలుగు పులి', minXp: 10500 },
];

export function levelForXp(totalXp: number): LevelDef {
  let best = LEVELS[0];
  for (const l of LEVELS) {
    if (totalXp >= l.minXp) best = l;
  }
  return best;
}

export function nextLevel(totalXp: number): LevelDef | null {
  for (const l of LEVELS) {
    if (totalXp < l.minXp) return l;
  }
  return null;
}

/** Freezes newly earned when lifetime XP moves prevTotal → newTotal. */
export function freezesEarned(prevTotal: number, newTotal: number): number {
  return Math.max(0, Math.floor(newTotal / FREEZE_EARN_XP) - Math.floor(prevTotal / FREEZE_EARN_XP));
}
