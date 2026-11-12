// Memory Flip: a face-down grid of phrases and meanings. Flipping a Telugu
// card plays it; two cards that belong together stay up with a sparkle, a
// mismatch flips back after a moment. No clock — just a gentle move counter.
// Turning over cards nobody has seen yet is exploring, not a mistake: a phrase
// only counts as missed when both of its cards were already known.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { isScriptItem, memoryPairsFor, memoryRound, type MemoryCard } from '../../engine/games';
import { rngFromSeed } from '../../engine/rng';
import { playItemAudio, sfx } from '../../audio';
import { TileText, useLockout, useOutcomes, useScriptMode, type GameProps } from './shared';

export function MemoryFlip({ items, seed, roundsPlayed, onFinish }: GameProps) {
  const scriptMode = useScriptMode();
  const reduce = useReducedMotion();
  const pairs = memoryPairsFor(items.length, roundsPlayed);
  const cards = useMemo(() => memoryRound(items, rngFromSeed(seed), pairs), [items, seed, pairs]);
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const [up, setUp] = useState<string[]>([]); // keys currently face up (unmatched)
  const [done, setDone] = useState<Set<string>>(new Set()); // matched item ids
  const [moves, setMoves] = useState(0);
  const [sparkle, setSparkle] = useState<string | null>(null);
  const seen = useRef(new Set<string>()); // card keys the player has already turned over
  const [locked, lock] = useLockout();
  const outcomes = useOutcomes();
  const started = useRef(Date.now());
  const finished = useRef(false);

  // the finish is scheduled once and reads its callbacks through refs: a
  // re-render during the pause (the sparkle clearing, a sync) must never
  // cancel it, or the round would sit on a solved board for ever
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const finishTimer = useRef<number | null>(null);
  useEffect(() => {
    if (done.size < pairs || finished.current) return;
    finished.current = true;
    finishTimer.current = window.setTimeout(
      () => onFinishRef.current({ game: 'memory', outcomes: outcomes.list(), bestCombo: 0, durationMs: Date.now() - started.current }),
      reduce ? 200 : 700,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, pairs]);
  useEffect(
    () => () => {
      if (finishTimer.current !== null) window.clearTimeout(finishTimer.current);
    },
    [],
  );

  const flip = async (card: MemoryCard) => {
    if (locked || up.includes(card.key) || done.has(card.itemId) || up.length >= 2) return;
    // a reading-track card stays silent until it is matched: its sound is the other card
    if (card.face === 'te' && !isScriptItem(card.itemId)) void playItemAudio(card.itemId);
    const nextUp = [...up, card.key];
    setUp(nextUp);
    if (nextUp.length < 2) return;
    setMoves((m) => m + 1);
    const [a, b] = nextUp.map((k) => cards.find((c) => c.key === k)!);
    // what the player had already seen BEFORE this move decides whether a
    // mismatch was a memory slip or just the luck of an unexplored board
    const knewBoth = (c: MemoryCard) => cards.filter((o) => o.itemId === c.itemId).every((o) => seen.current.has(o.key));
    const slips = [a, b].filter(knewBoth).map((c) => c.itemId);
    seen.current.add(a.key);
    seen.current.add(b.key);
    if (a.itemId === b.itemId) {
      // a match never blocks the next flip — only the sparkle lingers
      outcomes.hit(a.itemId);
      sfx.correct();
      if (isScriptItem(a.itemId)) void playItemAudio(a.itemId);
      setSparkle(a.itemId);
      setDone(new Set(done).add(a.itemId));
      setUp([]);
      window.setTimeout(() => setSparkle((cur) => (cur === a.itemId ? null : cur)), reduce ? 150 : 700);
      return;
    }
    for (const id of slips) outcomes.miss(id);
    sfx.wrong();
    await lock(900); // long enough for a child to look at both
    setUp([]);
  };

  const cols = cards.length <= 6 ? 'grid-cols-3' : 'grid-cols-4';

  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="game-memory" data-pairs={pairs} data-found={done.size}>
      <div className="flex items-center justify-between text-sm font-extrabold">
        <span className="text-ink-soft">
          Found {done.size} / {pairs}
        </span>
        <span className="rounded-full bg-card px-3 py-1 shadow-press">Moves {moves}</span>
      </div>
      <div className={`grid ${cols} gap-2.5`}>
        {cards.map((card) => {
          const item = byId.get(card.itemId)!;
          const faceUp = up.includes(card.key) || done.has(card.itemId);
          const matched = done.has(card.itemId);
          return (
            <button
              key={card.key}
              type="button"
              data-card-key={card.key}
              data-item-id={card.itemId}
              data-face={card.face}
              data-up={faceUp ? 'true' : 'false'}
              aria-label={faceUp ? (card.face === 'te' ? (isScriptItem(item.id) ? item.te : item.roman) : item.gloss) : 'Face-down card'}
              onClick={() => void flip(card)}
              disabled={matched}
              className="relative aspect-[3/4] min-h-[88px]"
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            >
              <FlipCard
                faceUp={faceUp}
                reduce={!!reduce}
                pulse={sparkle === card.itemId}
                back={
                  <div className="flex h-full w-full items-center justify-center rounded-2xl border-b-4 border-teal-dark bg-teal text-3xl text-white shadow-soft" aria-hidden="true">
                    🦜
                  </div>
                }
                front={
                  <div
                    className={`relative flex h-full w-full items-center justify-center rounded-2xl border-2 border-b-4 px-1 text-center ${
                      matched ? 'border-success bg-success-soft' : 'border-line bg-card'
                    }`}
                  >
                    {card.face === 'te' ? (
                      <TileText item={item} scriptMode={scriptMode} small />
                    ) : (
                      <span className="max-w-full break-words text-sm font-extrabold leading-tight">{item.gloss}</span>
                    )}
                    {matched && sparkle === card.itemId && (
                      <span className="absolute -right-1 -top-1 text-lg" aria-hidden="true">
                        ✨
                      </span>
                    )}
                  </div>
                }
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A card flip that works everywhere: squash to a line, swap the face, grow
 * back. (A true 3D flip with hidden backfaces renders mirrored fronts in some
 * engines, so the games never rely on it.)
 */
function FlipCard({ faceUp, reduce, pulse, back, front }: { faceUp: boolean; reduce: boolean; pulse: boolean; back: ReactNode; front: ReactNode }) {
  const [shown, setShown] = useState(faceUp);
  useEffect(() => {
    if (shown === faceUp) return;
    const t = window.setTimeout(() => setShown(faceUp), reduce ? 0 : 140);
    return () => window.clearTimeout(t);
  }, [faceUp, shown, reduce]);
  const flipping = shown !== faceUp;
  return (
    <motion.div
      className="absolute inset-0"
      animate={{ scaleX: flipping && !reduce ? 0 : 1, scale: pulse && !reduce ? [1, 1.08, 1] : 1 }}
      transition={{ duration: reduce ? 0 : 0.14, ease: 'easeInOut' }}
    >
      {shown ? front : back}
    </motion.div>
  );
}
