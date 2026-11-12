// Pair Pop: Telugu on the left, meanings (or, for letters, their sounds) on the right. Tap one of each; a
// match pops both tiles and fresh ones slide in, a miss shakes and shows the
// right partner. Three in a row doubles the combo, six triples it, and the
// round ends when the clock or the queue runs out.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { comboMultiplier, isScriptItem, pairsRound, type GameItem } from '../../engine/games';
import { rngFromSeed, shuffled } from '../../engine/rng';
import { playItemAudio, sfx } from '../../audio';
import { TileText, useLockout, useOutcomes, useScriptMode, type GameProps } from './shared';

type Slot = GameItem | null;

export function PairPop({ items, seed, roundsPlayed, onFinish }: GameProps) {
  const scriptMode = useScriptMode();
  const reduce = useReducedMotion();
  const round = useMemo(() => pairsRound(items, rngFromSeed(seed), roundsPlayed < 2 ? 1 : 2), [items, seed, roundsPlayed]);
  // the first board is dealt with the component (no empty frame): the same
  // phrases on both sides, in different orders
  const [left, setLeft] = useState<Slot[]>(() => shuffled(round.queue.slice(0, round.boardSize), rngFromSeed(`${seed}:left`)));
  const [right, setRight] = useState<Slot[]>(() => shuffled(round.queue.slice(0, round.boardSize), rngFromSeed(`${seed}:right`)));
  const queuePos = useRef(round.boardSize);
  const [pickL, setPickL] = useState<string | null>(null);
  const [pickR, setPickR] = useState<string | null>(null);
  const [popping, setPopping] = useState<Set<string>>(new Set());
  const [shaking, setShaking] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState<string | null>(null);
  const [combo, setCombo] = useState(0);
  const bestCombo = useRef(0);
  const [matched, setMatched] = useState(0);
  const [timeLeft, setTimeLeft] = useState(round.seconds);
  const [locked, lock] = useLockout();
  const outcomes = useOutcomes();
  const started = useRef(Date.now());
  const finished = useRef(false);
  const latest = useRef({ left, right, matched });
  latest.current = { left, right, matched };

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onFinish({ game: 'pairs', outcomes: outcomes.list(), bestCombo: bestCombo.current, durationMs: Date.now() - started.current });
  };

  // the clock
  useEffect(() => {
    const t = window.setInterval(() => {
      const left = Math.max(0, round.seconds - (Date.now() - started.current) / 1000);
      setTimeLeft(left);
      if (left <= 0) {
        window.clearInterval(t);
        finish();
      }
    }, 200);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.seconds]);

  const resolve = async (lid: string, rid: string) => {
    setPickL(null);
    setPickR(null);
    if (lid === rid) {
      outcomes.hit(lid);
      sfx.correct();
      // a letter is only spoken once it has been read and matched
      if (isScriptItem(lid)) void playItemAudio(lid);
      const streak = combo + 1;
      setCombo(streak);
      bestCombo.current = Math.max(bestCombo.current, streak);
      setPopping(new Set([lid]));
      await lock(reduce ? 120 : 260);
      setPopping(new Set());
      // replace the popped tiles in place so nothing else jumps around
      const fresh: Slot = round.queue[queuePos.current] ?? null;
      if (fresh) queuePos.current += 1;
      const nextLeft = latest.current.left.map((s) => (s?.id === lid ? fresh : s));
      const nextRight = latest.current.right.map((s) => (s?.id === rid ? fresh : s));
      setLeft(nextLeft);
      setRight(nextRight);
      const done = latest.current.matched + 1;
      setMatched(done);
      if (nextLeft.every((s) => s === null)) finish();
      return;
    }
    outcomes.miss(lid);
    outcomes.miss(rid);
    sfx.wrong();
    setCombo(0);
    setShaking(new Set([lid, rid]));
    setHint(lid); // glow the meaning that belongs to the tapped Telugu
    void playItemAudio(lid);
    await lock(reduce ? 300 : 700);
    setShaking(new Set());
    setHint(null);
  };

  const tapLeft = (id: string) => {
    if (locked) return;
    setPickL(id);
    // speaking a reading-track tile on tap would give away the sound it has to be matched to
    if (!isScriptItem(id)) void playItemAudio(id);
    if (pickR) void resolve(id, pickR);
  };
  const tapRight = (id: string) => {
    if (locked) return;
    setPickR(id);
    if (pickL) void resolve(pickL, id);
  };

  const pct = timeLeft / round.seconds;
  const mult = comboMultiplier(combo);
  const tileBase =
    'flex h-full min-h-[68px] w-full items-center justify-center rounded-2xl border-2 border-b-4 bg-card px-2 py-2 text-center transition-colors';

  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="game-pairs" data-matched={matched}>
      <div className="flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-line/80" role="timer" aria-label={`${Math.ceil(timeLeft)} seconds left`}>
          <div
            className={`h-full rounded-full ${pct < 0.2 ? 'btn-error' : 'btn-teal'}`}
            style={{ width: `${pct * 100}%`, transition: 'width 0.2s linear' }}
          />
        </div>
        <span className="w-10 text-right font-extrabold tabular-nums">{Math.ceil(timeLeft)}</span>
      </div>
      <div className="flex items-center justify-between text-sm font-extrabold">
        <span className="text-ink-soft">
          Matched {matched} / {round.queue.length}
        </span>
        <motion.span
          key={mult}
          initial={reduce ? false : { scale: 0.6 }}
          animate={{ scale: 1 }}
          className={`rounded-full px-3 py-1 ${mult > 1 ? 'bg-marigold text-white' : 'bg-card text-ink-soft shadow-press'}`}
        >
          {mult > 1 ? `Combo ×${mult}` : `Combo ${combo}`}
        </motion.span>
      </div>

      <div className="grid flex-1 grid-cols-2 content-start gap-3">
        {left.map((_, i) => (
          <Fragment key={i}>
            <PairTile
              slot={left[i]}
              side="te"
              selected={!!left[i] && pickL === left[i]!.id}
              popping={!!left[i] && popping.has(left[i]!.id)}
              shaking={!!left[i] && shaking.has(left[i]!.id)}
              hinted={false}
              reduce={!!reduce}
              onTap={tapLeft}
              className={tileBase}
            >
              {left[i] && <TileText item={left[i]!} scriptMode={scriptMode} />}
            </PairTile>
            <PairTile
              slot={right[i] ?? null}
              side="gloss"
              selected={!!right[i] && pickR === right[i]!.id}
              popping={!!right[i] && popping.has(right[i]!.id)}
              shaking={!!right[i] && shaking.has(right[i]!.id)}
              hinted={!!right[i] && hint === right[i]!.id}
              reduce={!!reduce}
              onTap={tapRight}
              className={tileBase}
            >
              {right[i] && <span className="text-base font-extrabold">{right[i]!.gloss}</span>}
            </PairTile>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function PairTile({
  slot,
  side,
  selected,
  popping,
  shaking,
  hinted,
  reduce,
  onTap,
  className,
  children,
}: {
  slot: Slot;
  side: 'te' | 'gloss';
  selected: boolean;
  popping: boolean;
  shaking: boolean;
  hinted: boolean;
  reduce: boolean;
  onTap: (id: string) => void;
  className: string;
  children: React.ReactNode;
}) {
  if (!slot) return <div className="min-h-[68px]" aria-hidden="true" />;
  return (
    <motion.button
      type="button"
      data-side={side}
      data-item-id={slot.id}
      onClick={() => onTap(slot.id)}
      aria-pressed={selected}
      animate={
        popping && !reduce
          ? { scale: [1, 1.15, 0], opacity: [1, 1, 0] }
          : shaking && !reduce
            ? { x: [0, -8, 8, -5, 5, 0] }
            : { scale: 1, opacity: 1, x: 0 }
      }
      transition={{ duration: popping ? 0.26 : 0.35 }}
      className={`${className} ${
        hinted
          ? 'border-success bg-success-soft ring-4 ring-success/30'
          : shaking
            ? 'border-error bg-error-soft'
            : selected
              ? 'border-teal bg-teal-soft ring-2 ring-teal/30'
              : 'border-line hover:border-teal/40'
      }`}
      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
    >
      {children}
    </motion.button>
  );
}
