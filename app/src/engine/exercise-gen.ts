// Generates the exercise sequence for a lesson from its content items.
// Deterministic for a given seed, so a lesson replays identically and tests
// can assert exact output.

import type { ChoiceExercise, ContentItem, Exercise, ExerciseKind, Lesson, Unit } from './types';
import { rngFromSeed, shuffled, pickN, type Rng } from './rng';
import { isTraceable } from './trace';

export interface GenOptions {
  seed: string;
  /** items the learner has already been introduced to (skip intro cards) */
  seenItemIds: Set<string>;
  /** platform supports scored speaking (scored ASR or echo mode both count) */
  includeSpeak: boolean;
  /** global item pool for distractors beyond this unit */
  pool: ContentItem[];
}

// Every lesson climbs from easiest to hardest:
//   1. meet each new phrase: its card (meaning + audio), say it, then pick it by ear;
//   2. understand: hear or read each phrase and choose its meaning;
//   3. produce: choose, build, say or write each phrase from its meaning;
//   4. finale: one last phrase said (or written) from memory.
// Inside a step the exercise kinds take turns, so the same kind never piles up.
const UNDERSTAND: ExerciseKind[] = ['mc-audio', 'mc-te2en'];
const PRODUCE_SPEAK: ExerciseKind[] = ['speak', 'mc-en2te', 'speak', 'wordbank'];
const PRODUCE_NO_SPEAK: ExerciseKind[] = ['mc-en2te', 'wordbank'];
// Script (reading & writing) lessons write instead of speaking: by hand from
// memory (letters and short words), or with the Telugu keyboard.
const PRODUCE_SCRIPT: ExerciseKind[] = ['trace', 'type-script', 'trace', 'wordbank'];

function byId(pool: ContentItem[]): Map<string, ContentItem> {
  const m = new Map<string, ContentItem>();
  for (const it of pool) m.set(it.id, it);
  return m;
}

/** 3 wrong choices for an item: curated distractors first, then same-unit, then pool. */
export function genChoices(item: ContentItem, unit: Unit, pool: ContentItem[], rng: Rng): string[] {
  const poolMap = byId(pool);
  const chosen: string[] = [];
  const seen = new Set<string>([item.id]);
  // reject candidates that read the same as the answer or an option already
  // picked (identical te or gloss) — duplicates make the right answer ambiguous
  const usedTe = new Set<string>([item.te]);
  const usedGloss = new Set<string>([item.gloss.toLowerCase()]);
  const take = (ids: string[]) => {
    for (const id of ids) {
      if (chosen.length >= 3) break;
      const cand = poolMap.get(id);
      if (!cand || seen.has(id)) continue;
      seen.add(id);
      if (usedTe.has(cand.te) || usedGloss.has(cand.gloss.toLowerCase())) continue;
      chosen.push(id);
      usedTe.add(cand.te);
      usedGloss.add(cand.gloss.toLowerCase());
    }
  };
  take(shuffled(item.distractors ?? [], rng));
  take(shuffled(unit.items.filter((i) => i.id !== item.id).map((i) => i.id), rng));
  take(shuffled(pool.map((i) => i.id), rng));
  return shuffled([item.id, ...chosen], rng);
}

/** Distractor word tiles for a wordbank exercise. */
export function genTiles(item: ContentItem, unit: Unit, rng: Rng): string[] {
  const display = (w: { te: string; roman: string }) => (unit.track === 'script' ? w.te : w.roman);
  const own = item.words.map(display);
  const ownSet = new Set(own.map((w) => w.toLowerCase()));
  const others = unit.items
    .filter((i) => i.id !== item.id)
    .flatMap((i) => i.words.map(display))
    .filter((w) => !ownSet.has(w.toLowerCase()));
  const distinct = [...new Set(others)];
  const nDistractors = Math.min(own.length >= 4 ? 3 : 2, distinct.length);
  return shuffled([...own, ...pickN(distinct, nDistractors, rng)], rng);
}

function exerciseFor(kind: ExerciseKind, item: ContentItem, unit: Unit, pool: ContentItem[], rng: Rng): Exercise {
  switch (kind) {
    case 'wordbank':
      return { kind, itemId: item.id, tiles: genTiles(item, unit, rng) };
    case 'trace':
      // generated here = written from memory; the guided trace is added with the card
      return { kind, itemId: item.id, guide: false };
    case 'speak':
    case 'type-script':
    case 'intro':
      return { kind, itemId: item.id } as Exercise;
    default:
      return { kind: kind as ChoiceExercise['kind'], itemId: item.id, choiceIds: genChoices(item, unit, pool, rng) };
  }
}

/**
 * A lesson session, easiest to hardest: each new phrase is shown with its
 * meaning and audio, said aloud, then picked by ear; after that every phrase
 * of the lesson is understood (meaning from sound or text), then produced
 * (chosen, built, said or written from its meaning), and one is said or
 * written once more as the finale.
 */
export function genLessonExercises(unit: Unit, lesson: Lesson, opts: GenOptions): Exercise[] {
  const rng = rngFromSeed(opts.seed);
  const itemsById = byId(unit.items);
  const items = lesson.itemIds.map((id) => {
    const it = itemsById.get(id);
    if (!it) throw new Error(`lesson ${unit.id}:${lesson.id} references missing item ${id}`);
    return it;
  });

  const out: Exercise[] = [];
  const isScript = unit.track === 'script';
  const canSpeak = !isScript && opts.includeSpeak;
  const add = (kind: ExerciseKind, item: ContentItem) => out.push(exerciseFor(kind, item, unit, opts.pool, rng));

  // 1. meet the new phrases one at a time: card → say it (or trace it) → pick it by ear
  for (const item of items.filter((it) => !opts.seenItemIds.has(it.id))) {
    out.push({ kind: 'intro', itemId: item.id });
    if (canSpeak) add('speak', item);
    if (isScript && isTraceable(item.te)) out.push({ kind: 'trace', itemId: item.id, guide: true });
    add('listen-pick', item);
  }

  // 2. understand, then 3. produce — every phrase of the lesson in each step,
  // the kinds taking turns from a seeded starting point
  const produce = isScript ? PRODUCE_SCRIPT : canSpeak ? PRODUCE_SPEAK : PRODUCE_NO_SPEAK;
  for (const kinds of [UNDERSTAND, produce]) {
    const start = Math.floor(rng() * kinds.length);
    shuffled(items, rng).forEach((item, k) => {
      let kind = kinds[(start + k) % kinds.length];
      // a one-word phrase has nothing to build: choose it instead, or where speaking
      // is off pick it by ear, so the same kind does not pile up
      if (kind === 'wordbank' && item.words.length < 2) kind = canSpeak ? 'mc-en2te' : 'listen-pick';
      // too long to draw in one go: build it from tiles, or write it with the keyboard
      if (kind === 'trace' && !isTraceable(item.te)) kind = item.words.length >= 2 ? 'wordbank' : 'type-script';
      add(kind, item);
    });
  }

  // 4. finale: the least-produced item, spoken (speak track) or written (script)
  const prodKind: ExerciseKind = isScript ? 'type-script' : 'speak';
  const prodCounts = new Map(items.map((it) => [it.id, 0]));
  for (const ex of out) {
    if (ex.kind === prodKind) prodCounts.set(ex.itemId, (prodCounts.get(ex.itemId) ?? 0) + 1);
  }
  const finaleItem = [...items].sort((a, b) => (prodCounts.get(a.id) ?? 0) - (prodCounts.get(b.id) ?? 0))[0];
  out.push(
    exerciseFor(
      isScript
        ? 'type-script'
        : opts.includeSpeak
          ? 'speak'
          : finaleItem.words.length >= 2
            ? 'wordbank'
            : 'listen-pick',
      finaleItem,
      unit,
      opts.pool,
      rng,
    ),
  );

  // stand-ins for breaking a run the lesson cannot break by reordering
  const altKinds: ExerciseKind[] = isScript
    ? ['listen-pick', 'mc-te2en', 'mc-audio', 'wordbank', 'type-script']
    : ['listen-pick', 'mc-te2en', 'mc-audio', 'mc-en2te', 'wordbank'];
  return arrangeExercises(out, false, (ex) => {
    const item = itemsById.get(ex.itemId);
    if (!item) return [];
    return altKinds
      .filter((k) => k !== ex.kind && (k !== 'wordbank' || item.words.length >= 2))
      .map((k) => exerciseFor(k, item, unit, opts.pool, rng));
  });
}

/**
 * Final ordering pass. Guarantees, in this order of priority:
 *  - an item is never practised before its "new phrase" card, and the finale
 *    stays last;
 *  - the same exercise (kind + item) never comes twice in a row;
 *  - no more than three exercises of one kind in a row (a phrase card in
 *    between counts as a break).
 * Exercises trade places with each other, so every item keeps all of its
 * practice. Where trading cannot break a run (a lesson that is nearly all
 * speaking), `alternatives` supplies the same item as a different exercise;
 * a back-to-back repeat that still cannot be separated is dropped.
 */
export function arrangeExercises(
  input: readonly Exercise[],
  hasOpener: boolean,
  alternatives: (ex: Exercise) => Exercise[] = () => [],
): Exercise[] {
  const seq = [...input];
  // tracing over the guide belongs to the card before it: it is not the same
  // exercise as writing from memory, and it never moves or gets replaced
  const guided = (ex: Exercise) => ex.kind === 'trace' && ex.guide;
  const same = (a: Exercise, b: Exercise) => a.kind === b.kind && a.itemId === b.itemId && guided(a) === guided(b);
  const isIntro = (i: number) => seq[i].kind === 'intro';
  // penalty at sequence index i
  const bad = (i: number): number => {
    if (i <= 0 || i >= seq.length || isIntro(i)) return 0;
    let n = 0;
    let p = i - 1;
    while (p >= 0 && isIntro(p)) p--;
    if (p >= 0 && same(seq[i], seq[p])) n += 1;
    if (i >= 3 && seq[i].kind === seq[i - 1].kind && seq[i].kind === seq[i - 2].kind && seq[i].kind === seq[i - 3].kind) n += 1;
    return n;
  };
  const total = (): number => {
    let n = 0;
    for (let i = 1; i < seq.length; i++) n += bad(i);
    return n;
  };

  for (let guard = 0; guard < 8 && total() > 0; guard++) {
    const introAt = new Map<string, number>();
    seq.forEach((ex, i) => {
      if (ex.kind === 'intro') introAt.set(ex.itemId, i);
    });
    const afterIntro = (ex: Exercise, i: number) => (introAt.get(ex.itemId) ?? -1) < i;
    const lastIdx = seq.length - 1; // the finale
    const movable = (i: number) => i >= 0 && i < lastIdx && !isIntro(i) && !guided(seq[i]) && !(hasOpener && i < 2);

    for (let i = 1; i < seq.length; i++) {
      if (bad(i) === 0) continue;
      // 1. trade places: this one, or a neighbour inside the run when it is fixed
      let fixed = false;
      for (const m of [i, i - 1, i - 2].filter(movable)) {
        for (let j = lastIdx - 1; j >= 0 && !fixed; j--) {
          if (j === m || !movable(j)) continue;
          const a = seq[m];
          const b = seq[j];
          if (same(a, b) || !afterIntro(a, j) || !afterIntro(b, m)) continue;
          const before = total();
          seq[m] = b;
          seq[j] = a;
          if (total() < before) fixed = true;
          else {
            seq[m] = a;
            seq[j] = b;
          }
        }
        if (fixed) break;
      }
      if (fixed) continue;
      // 2. same item, different exercise
      for (const m of [i - 1, i - 2, i].filter(movable)) {
        const original = seq[m];
        const before = total();
        for (const alt of alternatives(original)) {
          seq[m] = alt;
          if (total() < before) {
            fixed = true;
            break;
          }
          seq[m] = original;
        }
        if (fixed) break;
      }
    }

    // 3. a repeat that still sits back to back cannot be separated: drop it
    for (let i = seq.length - 1; i >= 1; i--) {
      if (isIntro(i)) continue;
      let p = i - 1;
      while (p >= 0 && isIntro(p)) p--;
      if (p < 0 || !same(seq[i], seq[p])) continue;
      seq.splice(i === seq.length - 1 || (hasOpener && i < 2) ? p : i, 1);
      break;
    }
  }
  return seq;
}
