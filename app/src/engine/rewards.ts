// Shapes shared by the store and the lesson-complete screen.
import type { XpAward } from '../store';
import type { Quest } from './quests';
import type { BadgeRow } from './badges';

export interface LessonCoins {
  lesson: number;
  perfect: number;
  goal: number;
  milestone: number;
  total: number;
}

export interface LessonRewards {
  award: XpAward;
  coins: LessonCoins;
  /** streak milestone reached by this lesson (3, 7, 14…), if any */
  milestone: number | null;
  questsCompleted: Quest[];
  badgesEarned: BadgeRow[];
}

/** Where the coin pill sits on screen, so flying coins know where to land. */
export function coinTarget(): { x: number; y: number } | null {
  const el = document.querySelector('[data-testid="coin-balance"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
