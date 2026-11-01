// Spaced repetition via ts-fsrs. Cards are stored as plain JSON in Dexie;
// this module converts to/from the library's Date-bearing card shape.

import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from 'ts-fsrs';

export { Rating };

export interface StoredCard {
  id: string; // content item id
  due: string; // ISO
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number; // State enum value
  last_review: string | null;
  addedAt: string; // ISO — when the item entered the deck
}

const params = generatorParameters({ enable_fuzz: false });
const scheduler = fsrs(params);

function toCard(sc: StoredCard): Card {
  return {
    due: new Date(sc.due),
    stability: sc.stability,
    difficulty: sc.difficulty,
    elapsed_days: sc.elapsed_days,
    scheduled_days: sc.scheduled_days,
    learning_steps: sc.learning_steps,
    reps: sc.reps,
    lapses: sc.lapses,
    state: sc.state as State,
    last_review: sc.last_review ? new Date(sc.last_review) : undefined,
  } as Card;
}

function fromCard(id: string, c: Card, addedAt: string): StoredCard {
  return {
    id,
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: (c as { learning_steps?: number }).learning_steps ?? 0,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.toISOString() : null,
    addedAt,
  };
}

/** Create a brand-new card for a just-learned item. */
export function newCard(itemId: string, now: Date): StoredCard {
  const c = createEmptyCard(now);
  return fromCard(itemId, c, now.toISOString());
}

/** Apply a review with the given rating; returns the rescheduled card. */
export function reviewCard(sc: StoredCard, rating: Rating, now: Date): StoredCard {
  const c = toCard(sc);
  const rec = scheduler.next(c, now, rating as Exclude<Rating, Rating.Manual>);
  return fromCard(sc.id, rec.card, sc.addedAt);
}

/** Cards due for review at `now`, most overdue first. */
export function dueCards(cards: StoredCard[], now: Date): StoredCard[] {
  const t = now.getTime();
  return cards
    .filter((c) => new Date(c.due).getTime() <= t)
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
}

/** Map an exercise outcome to an FSRS rating (used outside review mode). */
export function ratingForOutcome(correct: boolean, struggled: boolean): Rating {
  if (!correct) return Rating.Again;
  return struggled ? Rating.Hard : Rating.Good;
}
