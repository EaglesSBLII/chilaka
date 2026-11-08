// Orchestrates a lesson: exercise queue, CHECK/CONTINUE flow, wrong-answer
// requeue, XP accounting, SRS updates, completion celebration.

import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useApp } from '../store';
import { trackItems, unitById } from '../content/load';
import { genLessonExercises } from '../engine/exercise-gen';
import { xpForExercise, lessonCompletionBonus } from '../engine/xp';
import { Rating } from '../engine/srs';
import type { Exercise } from '../engine/types';
import { Button, ProgressBar } from '../components/ui';
import { Mascot } from '../components/Mascot';
import { sfx } from '../audio';
import type { AnswerEval } from './exercises/shared';
import { Intro } from './exercises/Intro';
import { Choice } from './exercises/Choice';
import { Wordbank } from './exercises/Wordbank';
import { Speak } from './exercises/Speak';
import { TypeScriptEx } from './exercises/TypeScriptEx';
import { LessonComplete, type CompletionStats } from './LessonComplete';

interface QueueEntry {
  exercise: Exercise;
  isRetry: boolean;
}

export function LessonPlayer({ unitId, lessonId }: { unitId: string; lessonId: string }) {
  const navigate = useApp((s) => s.navigate);
  const profile = useApp((s) => s.profile);
  const srsCards = useApp((s) => s.srsCards);
  const store = useApp;

  const unit = unitById(unitId);
  const lesson = unit?.lessons.find((l) => l.id === lessonId);

  const attempt = useMemo(() => Date.now(), []);
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'answering' | 'feedback'>('answering');
  const [lastEval, setLastEval] = useState<AnswerEval | null>(null);
  const [done, setDone] = useState<CompletionStats | null>(null);
  const evaluator = useRef<(() => AnswerEval) | null>(null);
  const firstTry = useRef<Map<string, boolean>>(new Map()); // exercise key → first attempt correct
  const wrongItems = useRef<Set<string>>(new Set());
  const xpEarned = useRef(0);

  // Build the queue once per mount (seeded by attempt so retries reshuffle)
  useEffect(() => {
    if (!unit || !lesson) return;
    const seen = new Set(Object.keys(srsCards));
    const exercises = genLessonExercises(unit, lesson, {
      seed: `${unitId}:${lessonId}:${attempt}`,
      seenItemIds: seen,
      includeSpeak: true, // echo mode still works on web
      pool: trackItems(unit.track), // distractors stay within the pathway
    });
    setQueue(exercises.map((exercise) => ({ exercise, isRetry: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, lessonId]);

  if (!unit || !lesson) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="font-bold">Lesson not found.</p>
        <Button onClick={() => navigate({ name: 'path' })}>Back</Button>
      </div>
    );
  }
  if (!queue) return null;
  if (done) return <LessonComplete stats={done} />;

  const entry = queue[idx];
  const item = unit.items.find((i) => i.id === entry.exercise.itemId)!;
  const progress = idx / queue.length;

  const applyEval = (ev: AnswerEval) => {
    const key = `${entry.exercise.kind}:${entry.exercise.itemId}`;
    if (ev.override) {
      // learner says the mic misheard a correct attempt — undo the miss
      if (!entry.isRetry && firstTry.current.get(key) === false) {
        firstTry.current.set(key, true);
        xpEarned.current += xpForExercise(entry.exercise.kind, true);
      }
      wrongItems.current.delete(entry.exercise.itemId);
      setQueue((q) => {
        if (!q) return q;
        // drop the retry copy the failed grade just queued (same exercise ref)
        for (let k = q.length - 1; k > idx; k--) {
          if (q[k].isRetry && q[k].exercise === entry.exercise) {
            return [...q.slice(0, k), ...q.slice(k + 1)];
          }
        }
        return q;
      });
      setLastEval({ ...ev, correct: true });
      setPhase('feedback');
      sfx.correct();
      return;
    }
    setLastEval(ev);
    setPhase('feedback');
    if (!entry.isRetry && !firstTry.current.has(key)) {
      firstTry.current.set(key, ev.correct);
      if (ev.correct) xpEarned.current += xpForExercise(entry.exercise.kind, true);
    }
    if (ev.correct) {
      if (entry.exercise.kind !== 'intro') sfx.correct();
    } else {
      sfx.wrong();
      wrongItems.current.add(entry.exercise.itemId);
      // requeue a retry copy at the end (only once per instance)
      if (!entry.isRetry) {
        setQueue((q) => (q ? [...q, { exercise: entry.exercise, isRetry: true }] : q));
      }
    }
  };

  const check = () => {
    if (!evaluator.current) return;
    applyEval(evaluator.current());
    evaluator.current = null;
  };

  const advance = async () => {
    setPhase('answering');
    setLastEval(null);
    evaluator.current = null;
    if (idx + 1 < queue.length) {
      setIdx(idx + 1);
      return;
    }
    // ---- lesson finished ----
    const results = [...firstTry.current.values()];
    const gradeable = results.length;
    const correct = results.filter(Boolean).length;
    const pct = gradeable === 0 ? 1 : correct / gradeable;
    const bonus = lessonCompletionBonus(pct);
    const total = xpEarned.current + bonus;

    await store.getState().introduceItems(lesson.itemIds);
    for (const id of lesson.itemIds) {
      if (srsCards[id]) {
        await store.getState().applyReview(id, wrongItems.current.has(id) ? Rating.Hard : Rating.Good);
      }
    }
    const rewards = await store.getState().finishLesson(unitId, lessonId, pct, total);
    sfx.complete();
    if (rewards.milestone === null) {
      confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 }, colors: ['#F5A623', '#FF5C39', '#3CB46E', '#0E6B63'] });
    }
    setDone({ xp: total, pct, award: rewards.award, rewards, unitTitle: unit.title, lessonTitle: lesson.title });
  };

  const ExComp =
    entry.exercise.kind === 'intro'
      ? Intro
      : entry.exercise.kind === 'wordbank'
        ? Wordbank
        : entry.exercise.kind === 'type-script'
          ? TypeScriptEx
          : entry.exercise.kind === 'speak'
            ? Speak // ASR missing → the component falls back to echo mode itself
            : Choice;

  const isIntro = entry.exercise.kind === 'intro';
  const isSpeak = entry.exercise.kind === 'speak';

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-5 py-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate({ name: 'path' })}
          className="text-2xl text-ink-soft transition-transform active:scale-90"
          aria-label="Quit lesson"
        >
          ✕
        </button>
        <ProgressBar pct={progress} className="flex-1" color="bg-success" />
        {entry.isRetry && <span className="text-xs font-bold text-flame uppercase">retry</span>}
      </div>

      <div
        className="flex-1 py-6"
        key={`${idx}-${entry.isRetry}`}
        data-testid="exercise"
        data-kind={entry.exercise.kind}
        data-item-id={entry.exercise.itemId}
        data-track={unit.track}
        data-phase={phase}
      >
        <ExComp
          exercise={entry.exercise}
          item={item}
          unit={unit}
          scriptMode={unit.track === 'script' ? 'telugu' : (profile?.scriptMode ?? 'roman+telugu')}
          phase={phase}
          lastEval={lastEval}
          onReady={(fn) => (evaluator.current = fn)}
          onAutoResult={(ev) => {
            if (isIntro) {
              // intro just enables CONTINUE without feedback banner
              evaluator.current = null;
              setLastEval(ev);
            } else {
              applyEval(ev);
            }
          }}
        />
      </div>

      {/* footer */}
      <div
        className={`sticky bottom-0 -mx-5 border-t-2 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${
          phase === 'feedback'
            ? lastEval?.correct
              ? 'border-success bg-success-soft'
              : 'border-error bg-error-soft'
            : 'border-line bg-bg'
        }`}
      >
        {phase === 'feedback' && lastEval && !isIntro && (
          <div className="mb-3 flex items-start gap-3">
            <Mascot pose={lastEval.correct ? 'cheer' : 'idle'} size={48} />
            <div>
              <div className={`text-lg font-extrabold ${lastEval.correct ? 'text-success-dark' : 'text-error-dark'}`}>
                {lastEval.correct ? praise() : 'Not quite —'}
              </div>
              {!lastEval.correct && lastEval.expected && (
                <div className="font-semibold text-ink">
                  Answer: <span className="font-extrabold">{lastEval.expected}</span>
                </div>
              )}
            </div>
          </div>
        )}
        {phase === 'answering' && isIntro && lastEval ? (
          <Button className="w-full text-lg" variant="secondary" onClick={() => void advance()}>
            Got it
          </Button>
        ) : phase === 'answering' ? (
          <div className="flex gap-3">
            {isSpeak && (
              <Button variant="ghost" className="flex-1" onClick={() => void advance()}>
                Skip
              </Button>
            )}
            <Button className="flex-[2] w-full text-lg" onClick={check} disabled={isSpeak}>
              Check
            </Button>
          </div>
        ) : (
          <Button
            className="w-full text-lg"
            variant={lastEval?.correct ? 'success' : 'danger'}
            onClick={() => void advance()}
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

const PRAISES = ['అద్భుతం! Awesome!', 'బాగుంది! Nice!', 'Correct!', 'శభాష్! Well done!', 'Perfect!'];
function praise(): string {
  return PRAISES[Math.floor(Math.random() * PRAISES.length)];
}
