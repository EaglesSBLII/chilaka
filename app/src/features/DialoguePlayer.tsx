// Dialogue roleplay: scripted scene where Chikki's cast speaks their lines
// and the learner produces theirs (speak on desktop, build-the-line anywhere).

import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useApp } from '../store';
import { allItems, itemById, unitById } from '../content/load';
import { playItemAudio } from '../audio';
import { genTiles } from '../engine/exercise-gen';
import { rngFromSeed } from '../engine/rng';
import { Button, Card } from '../components/ui';
import { Mascot } from '../components/Mascot';
import { sfx } from '../audio';
import { platform } from '../platform';
import { Speak } from './exercises/Speak';
import { Wordbank } from './exercises/Wordbank';
import type { AnswerEval } from './exercises/shared';

export function DialoguePlayer({ unitId }: { unitId: string }) {
  const navigate = useApp((s) => s.navigate);
  const profile = useApp((s) => s.profile);
  const store = useApp;
  const unit = unitById(unitId);
  const dialogue = unit?.dialogue;

  const [turnIdx, setTurnIdx] = useState(0);
  const [phase, setPhase] = useState<'answering' | 'feedback'>('answering');
  const [lastEval, setLastEval] = useState<AnswerEval | null>(null);
  const [finished, setFinished] = useState(false);
  const [useSpeak, setUseSpeak] = useState(false);
  const evaluator = useRef<(() => AnswerEval) | null>(null);
  const correctTurns = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void platform.asrAvailable().then(setUseSpeak);
  }, []);

  const turns = dialogue?.turns ?? [];
  const turn = turns[turnIdx];

  // Auto-play scripted (non-user) turns, then advance
  useEffect(() => {
    if (!turn || finished) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    if (!turn.userTurn) {
      let cancelled = false;
      void playItemAudio(turn.itemId).then(() => {
        if (!cancelled) setTimeout(() => setTurnIdx((i) => i + 1), 500);
      });
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnIdx, finished, turn?.itemId]);

  // Completion
  useEffect(() => {
    if (!dialogue || finished || turnIdx < turns.length) return;
    setFinished(true);
    void (async () => {
      const xp = 5 + correctTurns.current * 4;
      await store.getState().awardXp(xp, 'dialogue', dialogue.id);
      await store.getState().completeDialogue(unitId);
      sfx.fanfare();
      confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 }, colors: ['#F5A623', '#FF5C39', '#3CB46E'] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnIdx]);

  if (!unit || !dialogue) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="font-bold">Dialogue not found.</p>
        <Button onClick={() => navigate({ name: 'path' })}>Back</Button>
      </div>
    );
  }

  const userItem = turn?.userTurn ? itemById(turn.itemId) : null;
  const fakeExercise = useMemo(() => {
    if (!userItem) return null;
    if (useSpeak) return { kind: 'speak' as const, itemId: userItem.id };
    return { kind: 'wordbank' as const, itemId: userItem.id, tiles: genTiles(userItem, unit, rngFromSeed(`${dialogue.id}-${turnIdx}`)) };
  }, [userItem?.id, useSpeak, turnIdx, unit, dialogue.id, userItem]);

  const applyEval = (ev: AnswerEval) => {
    setLastEval(ev);
    setPhase('feedback');
    if (ev.correct) {
      correctTurns.current += 1;
      sfx.correct();
    } else {
      sfx.wrong();
    }
  };

  return (
    <div className="mx-auto flex h-screen max-w-xl flex-col px-5 py-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate({ name: 'path' })} className="text-2xl text-ink-soft" aria-label="Quit">
          ✕
        </button>
        <div>
          <h2 className="font-extrabold">{dialogue.title}</h2>
          <p className="text-xs font-semibold text-ink-soft">{dialogue.scene}</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
        <div className="flex flex-col gap-3">
          {turns.slice(0, finished ? turns.length : turnIdx + (turn?.userTurn ? 0 : 1)).map((t, i) => {
            const it = itemById(t.itemId)!;
            return (
              <div key={i} className={`flex ${t.userTurn ? 'justify-end' : 'justify-start'}`}>
                <button
                  onClick={() => void playItemAudio(t.itemId)}
                  className={`max-w-[80%] rounded-3xl border-2 px-4 py-2.5 text-left ${
                    t.userTurn ? 'bg-teal text-white border-teal-dark rounded-br-lg' : 'bg-card border-line rounded-bl-lg'
                  }`}
                >
                  <div className={`text-xs font-bold ${t.userTurn ? 'text-white/70' : 'text-ink-soft'}`}>{t.speaker}</div>
                  <div className="font-extrabold">{it.roman}</div>
                  <div className={`text-xs font-semibold ${t.userTurn ? 'text-white/80' : 'text-ink-soft'}`}>{it.gloss}</div>
                </button>
              </div>
            );
          })}
        </div>

        {finished && (
          <div className="flex flex-col items-center gap-4 py-8 text-center animate-pop">
            <Mascot pose="celebrate" size={120} />
            <h2 className="text-2xl font-extrabold text-teal">Scene complete! 🎭</h2>
            <Button onClick={() => navigate({ name: 'path' })}>Back to path</Button>
          </div>
        )}

        {!finished && turn?.userTurn && userItem && fakeExercise && (
          <Card className="mt-4 border-teal">
            <div className="mb-2 text-sm font-bold text-teal uppercase">Your line — {turn.speaker}</div>
            {phase === 'feedback' ? (
              <div className="flex flex-col gap-3">
                <div className={`font-extrabold ${lastEval?.correct ? 'text-success-dark' : 'text-error-dark'}`}>
                  {lastEval?.correct ? 'బాగుంది! 🎉' : `The line: ${userItem.roman}`}
                </div>
                <Button
                  variant={lastEval?.correct ? 'success' : 'danger'}
                  onClick={() => {
                    setPhase('answering');
                    setLastEval(null);
                    setTurnIdx((i) => i + 1);
                  }}
                >
                  Continue
                </Button>
              </div>
            ) : (
              <>
                <ExerciseHost
                  key={turnIdx}
                  exercise={fakeExercise}
                  itemId={userItem.id}
                  unitId={unitId}
                  scriptMode={profile?.scriptMode ?? 'roman+telugu'}
                  useSpeak={useSpeak}
                  onEval={applyEval}
                  evaluator={evaluator}
                />
                {!useSpeak && (
                  <Button
                    className="mt-3 w-full"
                    onClick={() => {
                      if (evaluator.current) applyEval(evaluator.current());
                    }}
                  >
                    Check
                  </Button>
                )}
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function ExerciseHost({
  exercise,
  itemId,
  unitId,
  scriptMode,
  useSpeak,
  onEval,
  evaluator,
}: {
  exercise: { kind: 'speak' | 'wordbank'; itemId: string; tiles?: string[] };
  itemId: string;
  unitId: string;
  scriptMode: 'roman' | 'roman+telugu' | 'telugu';
  useSpeak: boolean;
  onEval: (ev: AnswerEval) => void;
  evaluator: React.MutableRefObject<(() => AnswerEval) | null>;
}) {
  const unit = unitById(unitId)!;
  const item = allItems().find((i) => i.id === itemId)!;
  const Comp = useSpeak ? Speak : Wordbank;
  return (
    <Comp
      exercise={exercise as never}
      item={item}
      unit={unit}
      scriptMode={scriptMode}
      phase="answering"
      lastEval={null}
      onReady={(fn) => (evaluator.current = fn)}
      onAutoResult={onEval}
    />
  );
}
