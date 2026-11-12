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
import { TraceEx } from './exercises/TraceEx';
import { isComputer } from '../device';
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
  const firstTry = useRef<Map<number, boolean>>(new Map()); // queue position → first attempt correct
  const xpPaid = useRef<Set<string>>(new Set()); // kind:item already paid XP (a phrase pays once per kind)
  const idxRef = useRef(0);
  idxRef.current = idx;
  const finishing = useRef(false);
  const [busy, setBusy] = useState(false);
  const praiseLine = useRef('');
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

  const payXp = () => {
    // tracing over the guide and writing from memory are different work: each pays once
    const mode = entry.exercise.kind === 'trace' ? (entry.exercise.guide ? ':guided' : ':memory') : '';
    const key = `${entry.exercise.kind}${mode}:${entry.exercise.itemId}`;
    if (xpPaid.current.has(key)) return;
    xpPaid.current.add(key);
    xpEarned.current += xpForExercise(entry.exercise.kind, true);
  };

  const applyEval = (ev: AnswerEval) => {
    if (finishing.current) return;
    if (ev.correct) praiseLine.current = praise();
    if (ev.override) {
      // learner says the mic misheard a correct attempt — undo the miss
      if (!entry.isRetry && firstTry.current.get(idx) === false) {
        firstTry.current.set(idx, true);
        payXp();
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
    if (phase === 'feedback') {
      // a second take after the grade (Speak's Retry): it can turn the banner
      // green, but the exercise was already scored — no second requeue, and a
      // pass is never taken back
      if (ev.correct && !lastEval?.correct) {
        setLastEval(ev);
        sfx.correct();
      }
      return;
    }
    setLastEval(ev);
    setPhase('feedback');
    if (!entry.isRetry && !firstTry.current.has(idx)) {
      firstTry.current.set(idx, ev.correct);
      if (ev.correct) payXp();
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
    if (finishing.current) return;
    evaluator.current = null;
    if (idx + 1 < queue.length) {
      setPhase('answering');
      setLastEval(null);
      setIdx(idx + 1);
      return;
    }
    // ---- lesson finished ---- (once: the saves below take a moment, and the
    // last exercise must not come back to life for a second tap meanwhile)
    finishing.current = true;
    setBusy(true);
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
      } else if (wrongItems.current.has(id) && store.getState().srsCards[id]) {
        // met for the first time in this lesson and missed: bring it back sooner
        await store.getState().applyReview(id, Rating.Hard);
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
          : entry.exercise.kind === 'trace'
            ? TraceEx
          : entry.exercise.kind === 'speak'
            ? Speak // ASR missing → the component falls back to echo mode itself
            : Choice;

  const isIntro = entry.exercise.kind === 'intro';
  const isSpeak = entry.exercise.kind === 'speak';
  // drawing letters needs a touch screen: on a computer it can be skipped (no penalty, no XP)
  const canSkip = isSpeak || (entry.exercise.kind === 'trace' && isComputer());
  // writing from memory is checked by the learner inside the exercise, not with Check
  const selfChecked = entry.exercise.kind === 'trace' && !entry.exercise.guide;

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
          onSkip={() => {
            if (idxRef.current === idx) void advance();
          }}
          onAutoResult={(ev) => {
            // a result that arrives after the learner moved on (a slow
            // transcription, then Skip) belongs to an exercise that is gone
            if (idxRef.current !== idx || finishing.current) return;
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

      {/* footer (nothing to show while a self-checked exercise is being answered on a touch device) */}
      <div
        hidden={phase === 'answering' && selfChecked && !canSkip}
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
                {lastEval.correct ? praiseLine.current || 'Nice!' : 'Not quite —'}
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
          <Button className="w-full text-lg" variant="secondary" disabled={busy} onClick={() => void advance()}>
            Got it
          </Button>
        ) : phase === 'answering' ? (
          <div className="flex gap-3">
            {canSkip && (
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => void advance()}>
                Skip
              </Button>
            )}
            {!selfChecked && (
              <Button className="flex-[2] w-full text-lg" onClick={check} disabled={isSpeak}>
                Check
              </Button>
            )}
          </div>
        ) : (
          <Button
            className="w-full text-lg"
            variant={lastEval?.correct ? 'success' : 'danger'}
            disabled={busy}
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
