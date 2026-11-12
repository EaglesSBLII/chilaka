// Generates the exercise sequence for a lesson from its content items.
// Deterministic for a given seed, so a lesson replays identically and tests
// can assert exact output.

import type { ChoiceExercise, ContentItem, Exercise, ExerciseKind, Lesson, Unit } from './types';
import { rngFromSeed, shuffled, pickN, type Rng } from './rng';
import { allUnits } from '../content/load';

/** id of the very first speak-track unit on the path (hosts the demo opener). */
function firstSpeakUnitId(): string | undefined {
  return allUnits().find((u) => u.track === 'speak')?.id;
}

export interface GenOptions {
  seed: string;
  /** items the learner has already been introduced to (skip intro cards) */
  seenItemIds: Set<string>;
  /** platform supports scored speaking (scored ASR or echo mode both count) */
  includeSpeak: boolean;
  /** global item pool for distractors beyond this unit */
  pool: ContentItem[];
}

// Speaking-first weights: the course is about talking, so speak dominates the
// practice mix; listening MC backs it up; spelling-ish tasks are minimal.
const ROUND_WEIGHTS: [ExerciseKind, number][][] = [
  // round 1: recognize + start producing
  [
    ['speak', 0.4],
    ['listen-pick', 0.2],
    ['mc-audio', 0.12],
    ['mc-te2en', 0.1],
    ['mc-en2te', 0.08],
    ['wordbank', 0.1],
  ],
  // round 2: mostly production
  [
    ['speak', 0.55],
    ['listen-pick', 0.15],
    ['mc-audio', 0.08],
    ['mc-en2te', 0.1],
    ['wordbank', 0.12],
  ],
];

type TeachPattern = 'say-it' | 'interleaved' | 'listen-first';
const TEACH_PATTERNS: TeachPattern[] = ['say-it', 'interleaved', 'listen-first'];

// Script (reading & writing) lessons: recognition + WRITING with the Telugu
// keyboard; no speaking drills. type-script is the production backbone.
const SCRIPT_ROUND_WEIGHTS: [ExerciseKind, number][][] = [
  [
    ['type-script', 0.3],
    ['listen-pick', 0.2],
    ['mc-audio', 0.15],
    ['mc-te2en', 0.2],
    ['wordbank', 0.15],
  ],
  [
    ['type-script', 0.45],
    ['listen-pick', 0.15],
    ['mc-audio', 0.1],
    ['mc-te2en', 0.1],
    ['wordbank', 0.2],
  ],
];

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
    case 'speak':
    case 'type-script':
    case 'intro':
      return { kind, itemId: item.id } as Exercise;
    default:
      return { kind: kind as ChoiceExercise['kind'], itemId: item.id, choiceIds: genChoices(item, unit, pool, rng) };
  }
}

/** Weighted kind pick, respecting what the item supports. */
function pickKind(weights: [ExerciseKind, number][], item: ContentItem, includeSpeak: boolean, rng: Rng): ExerciseKind {
  const usable = weights.filter(([k]) => {
    if (k === 'wordbank' && item.words.length < 2) return false;
    if (k === 'speak' && !includeSpeak) return false;
    return true;
  });
  const total = usable.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [k, w] of usable) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return usable[usable.length - 1][0];
}

/**
 * A lesson session, talking-first. The teach phase itself varies between
 * lessons (three seeded patterns) so sessions don't feel formulaic, then two
 * speak-heavy practice rounds and a spoken finale. Roughly 55–65% of graded
 * exercises are speaking.
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
  // production exercise: speaking for the speak track, WRITING for script
  const speakOr = (fallback: ExerciseKind): ExerciseKind =>
    isScript ? 'type-script' : opts.includeSpeak ? 'speak' : fallback;

  // 0. demo opener for the very first lesson: Listen → Speak → Flashcard on the
  // first phrase, so every part of the app shows up in the first minute.
  let newItems = items.filter((it) => !opts.seenItemIds.has(it.id));
  let hasOpener = false;
  if (unit.id === firstSpeakUnitId() && lesson.id === 'l1' && items.length > 0 && !opts.seenItemIds.has(items[0].id)) {
    const first = items[0];
    out.push(exerciseFor('listen-pick', first, unit, opts.pool, rng));
    out.push(exerciseFor(speakOr('mc-audio'), first, unit, opts.pool, rng));
    out.push({ kind: 'intro', itemId: first.id });
    newItems = newItems.filter((it) => it.id !== first.id);
    hasOpener = true;
  }

  // 1. teach the unseen items — pattern varies per lesson seed
  const pattern = TEACH_PATTERNS[Math.floor(rng() * TEACH_PATTERNS.length)];
  if (pattern === 'say-it') {
    // hear it, then immediately say it — tightest listen→speak loop
    for (const item of newItems) {
      out.push({ kind: 'intro', itemId: item.id });
      out.push(exerciseFor(speakOr('mc-te2en'), item, unit, opts.pool, rng));
    }
  } else if (pattern === 'interleaved') {
    // teach in pairs, practice the pair together before moving on
    for (let i = 0; i < newItems.length; i += 2) {
      const pair = newItems.slice(i, i + 2);
      for (const item of pair) out.push({ kind: 'intro', itemId: item.id });
      for (const item of shuffled(pair, rng)) {
        out.push(exerciseFor('mc-te2en', item, unit, opts.pool, rng));
      }
      for (const item of shuffled(pair, rng)) {
        out.push(exerciseFor(speakOr('listen-pick'), item, unit, opts.pool, rng));
      }
    }
  } else {
    // listen-first: meet everything, then ears, then mouth
    for (const item of newItems) out.push({ kind: 'intro', itemId: item.id });
    for (const item of shuffled(newItems, rng)) {
      out.push(exerciseFor('listen-pick', item, unit, opts.pool, rng));
    }
    for (const item of shuffled(newItems, rng)) {
      out.push(exerciseFor(speakOr('mc-audio'), item, unit, opts.pool, rng));
    }
  }

  // 2. two production-heavy mixed rounds over all lesson items
  for (const weights of isScript ? SCRIPT_ROUND_WEIGHTS : ROUND_WEIGHTS) {
    for (const item of shuffled(items, rng)) {
      out.push(exerciseFor(pickKind(weights, item, isScript ? false : opts.includeSpeak, rng), item, unit, opts.pool, rng));
    }
  }

  // 3. finale: the least-produced item, spoken (speak track) or written (script)
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
  return arrangeExercises(out, hasOpener, (ex) => {
    const item = itemsById.get(ex.itemId);
    if (!item) return [];
    return altKinds
      .filter((k) => k !== ex.kind && (k !== 'wordbank' || item.words.length >= 2))
      .map((k) => exerciseFor(k, item, unit, opts.pool, rng));
  });
}

/**
 * Final ordering pass. Guarantees, in this order of priority:
 *  - an item is never practised before its "new phrase" card (the first
 *    lesson's listen → speak → card opener is the one deliberate exception
 *    and is never moved), and the finale stays last;
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
  const same = (a: Exercise, b: Exercise) => a.kind === b.kind && a.itemId === b.itemId;
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
    const movable = (i: number) => i >= 0 && i < lastIdx && !isIntro(i) && !(hasOpener && i < 2);

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
