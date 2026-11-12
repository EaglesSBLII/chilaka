// Shared contract + helpers for exercise components.

import { useState } from 'react';
import type { ContentItem, Exercise, ScriptMode, Unit } from '../../engine/types';

export interface AnswerEval {
  correct: boolean;
  /** friendly display of the expected answer, for the feedback banner */
  expected?: string;
  /** what the learner produced (typed/spoke) */
  got?: string;
  /** learner overrode a failed speech grade ("the mic misheard me") */
  override?: boolean;
}

export interface ExerciseProps {
  exercise: Exercise;
  item: ContentItem;
  unit: Unit;
  scriptMode: ScriptMode;
  /** 'answering' while interactive, 'feedback' after CHECK */
  phase: 'answering' | 'feedback';
  lastEval: AnswerEval | null;
  /** child registers its evaluator when an answer is ready (null = not ready) */
  onReady(evaluate: (() => AnswerEval) | null): void;
  /** child completed evaluation on its own (speak/intro flows) */
  onAutoResult(ev: AnswerEval): void;
  /** move on without a verdict (no XP, not counted): for exercises a learner may be unable to do */
  onSkip?(): void;
}

/**
 * Script-track immersion: English stays hidden until asked for, so the
 * learner reads the Telugu first.
 */
export function RevealGloss({ gloss }: { gloss: string }) {
  const [shown, setShown] = useState(false);
  if (shown) {
    return <div className="text-lg font-semibold text-teal animate-pop">{gloss}</div>;
  }
  return (
    <button
      onClick={() => setShown(true)}
      className="rounded-xl border-2 border-dashed border-line px-3 py-1.5 text-sm font-bold text-ink-soft hover:border-teal/50"
    >
      👁 Show English
    </button>
  );
}

/** Primary sentence display respecting the script mode. */
export function SentenceDisplay({
  item,
  scriptMode,
  size = 'text-2xl',
}: {
  item: ContentItem;
  scriptMode: ScriptMode;
  size?: string;
}) {
  const roman = <span className={`${size} font-extrabold`}>{item.roman}</span>;
  const te = <span className={`te-script ${scriptMode === 'telugu' ? size : 'text-lg'} text-ink-soft`}>{item.te}</span>;
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {scriptMode === 'telugu' ? (
        <>
          <span className={`te-script ${size} font-extrabold text-ink`}>{item.te}</span>
          <span className="text-lg text-ink-soft font-semibold">{item.roman}</span>
        </>
      ) : scriptMode === 'roman+telugu' ? (
        <>
          {roman}
          {te}
        </>
      ) : (
        roman
      )}
    </div>
  );
}
