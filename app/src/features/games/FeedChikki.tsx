// Feed Chikki: she says a phrase, the player taps the fruit that carries it.
// A wrong fruit shakes, the phrase plays again and the player tries once more;
// when only the right fruit is left, Chikki shows it and moves on.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { feedRound } from '../../engine/games';
import { rngFromSeed } from '../../engine/rng';
import { playItemAudio, playItemAudioAfterPause, sfx } from '../../audio';
import { Mascot } from '../../components/Mascot';
import { TileText, useLockout, useOutcomes, useScriptMode, type GameProps } from './shared';

const FRUITS = ['🥭', '🍌', '🍎', '🍇', '🍊', '🍉'];
const PROMPTS = 8;

export function FeedChikki({ items, seed, roundsPlayed, onFinish }: GameProps) {
  const scriptMode = useScriptMode();
  const reduce = useReducedMotion();
  const choices = Math.min(roundsPlayed < 3 ? 3 : 4, items.length);
  const prompts = useMemo(() => feedRound(items, rngFromSeed(seed), choices, PROMPTS), [items, seed, choices]);
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const [idx, setIdx] = useState(0);
  const [wrong, setWrong] = useState<Set<string>>(new Set());
  const [flying, setFlying] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [fed, setFed] = useState(0);
  const [pose, setPose] = useState<'idle' | 'teach' | 'celebrate'>('teach');
  const [locked, lock] = useLockout();
  const outcomes = useOutcomes();
  const started = useRef(Date.now());
  const finished = useRef(false);

  const prompt = prompts[idx];

  useEffect(() => {
    if (!prompt) return;
    setWrong(new Set());
    setFlying(null);
    setReveal(false);
    setPose('teach');
    return playItemAudioAfterPause(prompt.itemId);
  }, [prompt]);

  const next = () => {
    if (idx + 1 < prompts.length) {
      setIdx(idx + 1);
      return;
    }
    if (finished.current) return;
    finished.current = true;
    onFinish({ game: 'feed', outcomes: outcomes.list(), bestCombo: 0, durationMs: Date.now() - started.current });
  };

  const tap = async (id: string) => {
    if (!prompt || locked || reveal || flying) return;
    if (id === prompt.itemId) {
      outcomes.hit(id);
      sfx.correct();
      setFlying(id);
      setPose('celebrate');
      setFed((n) => n + 1);
      await lock(reduce ? 250 : 650);
      next();
      return;
    }
    outcomes.miss(prompt.itemId);
    sfx.wrong();
    const nextWrong = new Set(wrong).add(id);
    setWrong(nextWrong);
    setPose('idle');
    if (nextWrong.size >= prompt.choiceIds.length - 1) {
      // only the right fruit is left: show it, say it, move on
      setReveal(true);
      void playItemAudio(prompt.itemId);
      await lock(1400);
      next();
      return;
    }
    await lock(350);
    void playItemAudio(prompt.itemId);
  };

  if (!prompt) return null;

  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="game-feed" data-prompt-item={prompt.itemId} data-step={idx + 1}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-ink-soft">
          {idx + 1} / {prompts.length}
        </span>
        <span className="rounded-full bg-card px-3 py-1 text-sm font-extrabold shadow-press" aria-label={`${fed} fed`}>
          🥭 {fed}
        </span>
      </div>

      <div className="relative flex flex-col items-center gap-2">
        <motion.div animate={pose === 'celebrate' && !reduce ? { scale: [1, 1.12, 1], rotate: [0, -4, 4, 0] } : { scale: 1 }} transition={{ duration: 0.5 }}>
          <Mascot pose={pose} size={110} />
        </motion.div>
        <p className="font-extrabold">{reveal ? 'This one!' : 'Which one did Chikki say?'}</p>
        <div className="flex gap-3">
          <button
            onClick={() => void playItemAudio(prompt.itemId)}
            className="h-16 w-16 rounded-3xl bg-teal border-b-8 border-teal-dark text-3xl text-white transition-all active:border-b-2 active:translate-y-1"
            aria-label="Play again"
            style={{ touchAction: 'manipulation' }}
          >
            🔊
          </button>
          <button
            onClick={() => void playItemAudio(prompt.itemId, true)}
            className="h-16 w-16 rounded-3xl bg-card border-2 border-b-8 border-line text-2xl transition-all active:border-b-2 active:translate-y-1"
            aria-label="Play slowly"
            style={{ touchAction: 'manipulation' }}
          >
            🐢
          </button>
        </div>
      </div>

      <div className="grid flex-1 content-start gap-3" aria-live="polite">
        {prompt.choiceIds.map((id, i) => {
          const item = byId.get(id)!;
          const isWrong = wrong.has(id);
          const isAnswer = id === prompt.itemId;
          const flyAway = flying === id;
          return (
            <motion.button
              key={`${prompt.itemId}:${id}`}
              type="button"
              data-item-id={id}
              disabled={isWrong || locked}
              onClick={() => void tap(id)}
              animate={
                flyAway && !reduce
                  ? { y: -220, scale: 0.2, opacity: 0 }
                  : isWrong && !reduce
                    ? { x: [0, -10, 10, -6, 6, 0], opacity: 0.45 }
                    : { x: 0, y: 0, scale: 1, opacity: isWrong ? 0.45 : 1 }
              }
              transition={flyAway ? { duration: 0.45, ease: 'easeIn' } : { duration: 0.35 }}
              className={`flex min-h-[72px] items-center gap-4 rounded-3xl border-2 border-b-4 bg-card px-4 py-3 text-left transition-colors ${
                reveal && isAnswer ? 'border-success bg-success-soft' : isWrong ? 'border-error' : 'border-line hover:border-teal/40'
              }`}
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="text-3xl" aria-hidden="true">
                {FRUITS[i % FRUITS.length]}
              </span>
              <span className="flex flex-1 flex-col items-start">
                <TileText item={item} scriptMode={scriptMode} align="start" />
                {reveal && isAnswer && <span className="text-sm font-bold text-success-dark">{item.gloss}</span>}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
