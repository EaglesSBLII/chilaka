// Daily quests: two small, varied goals per day with a chest at the end.
// Generated deterministically from the day so every device agrees on ids.
import { rngFromSeed, shuffled } from './rng';
import { chestReward } from './coins';

// 'review' is the stored id of the game-rounds quest: it counted flashcards
// before Chikki's games replaced the review tab, and keeping the id keeps every
// device's quest list for the day in agreement.
export type QuestKind = 'earn-xp' | 'lessons' | 'perfect' | 'review' | 'speak';

export interface Quest {
  id: string; // `${day}:${kind}`
  day: string;
  kind: QuestKind;
  target: number;
  progress: number;
  claimedAt: string | null;
  reward: number | null; // coins granted when claimed
}

interface Template {
  kind: QuestKind;
  targets: number[];
}

const TEMPLATES: Template[] = [
  { kind: 'earn-xp', targets: [30, 50] },
  { kind: 'lessons', targets: [2] },
  { kind: 'perfect', targets: [1] },
  { kind: 'review', targets: [3] },
  { kind: 'speak', targets: [5] },
];

export function questTitle(q: Pick<Quest, 'kind' | 'target'>): string {
  switch (q.kind) {
    case 'earn-xp':
      return `Earn ${q.target} XP`;
    case 'lessons':
      return `Finish ${q.target} lessons`;
    case 'perfect':
      return 'Get a perfect lesson';
    case 'review':
      return `Play ${q.target} game round${q.target === 1 ? '' : 's'}`;
    case 'speak':
      return `Speak ${q.target} sentences`;
  }
}

/** Two distinct quests for the day. */
export function dailyQuests(day: string): Quest[] {
  const rng = rngFromSeed(`quests:${day}`);
  const picks = shuffled(TEMPLATES, rng).slice(0, 2);
  return picks.map((t) => ({
    id: `${day}:${t.kind}`,
    day,
    kind: t.kind,
    target: t.targets[Math.floor(rng() * t.targets.length)],
    progress: 0,
    claimedAt: null,
    reward: null,
  }));
}

export function isComplete(q: Quest): boolean {
  return q.progress >= q.target;
}

export function bump(q: Quest, n: number): Quest {
  if (q.claimedAt) return q;
  return { ...q, progress: Math.min(q.target, q.progress + n) };
}

/** Claim the chest: returns the quest with its reward fixed. */
export function claim(q: Quest, now = new Date()): Quest {
  if (!isComplete(q) || q.claimedAt) return q;
  return { ...q, claimedAt: now.toISOString(), reward: chestReward(q.id) };
}
