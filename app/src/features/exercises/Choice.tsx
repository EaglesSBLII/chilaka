// Multiple-choice family: mc-te2en, mc-en2te, mc-audio, listen-pick.

import { useEffect, useMemo, useState } from 'react';
import { itemById } from '../../content/load';
import { playItemAudio, playItemAudioAfterPause } from '../../audio';
import { Card } from '../../components/ui';
import type { ChoiceExercise, ContentItem } from '../../engine/types';
import type { ExerciseProps } from './shared';
import { SentenceDisplay } from './shared';

const PROMPTS: Record<ChoiceExercise['kind'], string> = {
  'mc-te2en': 'What does this mean?',
  'mc-en2te': 'How do you say this in Telugu?',
  'mc-audio': 'What did you hear?',
  'listen-pick': 'Pick what you heard',
};

export function Choice({ exercise, item, unit, scriptMode, phase, onReady }: ExerciseProps) {
  const ex = exercise as ChoiceExercise;
  const isScript = unit.track === 'script';
  const [selected, setSelected] = useState<string | null>(null);

  const choices = useMemo(
    () => ex.choiceIds.map((id) => itemById(id)).filter((x): x is ContentItem => Boolean(x)),
    [ex.choiceIds],
  );

  const audioKinds = ex.kind === 'mc-audio' || ex.kind === 'listen-pick';

  useEffect(() => {
    setSelected(null);
    onReady(null);
    if (audioKinds) return playItemAudioAfterPause(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  const select = (id: string) => {
    if (phase !== 'answering') return;
    setSelected(id);
    onReady(() => ({
      correct: id === item.id,
      expected: choiceLabel(ex.kind, item),
      got: choiceLabel(ex.kind, choices.find((c) => c.id === id)!),
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-extrabold">{PROMPTS[ex.kind]}</h2>

      {ex.kind === 'mc-te2en' && (
        <Card className="py-6">
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => void playItemAudio(item.id)} className="text-2xl active:scale-90" aria-label="Play">
              🔊
            </button>
            {isScript ? (
              <div className="te-script text-5xl font-extrabold">{item.te}</div>
            ) : (
              <SentenceDisplay item={item} scriptMode={scriptMode} />
            )}
          </div>
        </Card>
      )}

      {ex.kind === 'mc-en2te' && (
        <Card className="py-6 text-center">
          <div className="text-2xl font-extrabold text-teal">{item.gloss}</div>
        </Card>
      )}

      {audioKinds && (
        <div className="flex justify-center gap-4 py-2">
          <button
            onClick={() => void playItemAudio(item.id)}
            className="h-20 w-20 rounded-3xl bg-teal border-b-8 border-teal-dark text-4xl text-white transition-all active:border-b-2 active:translate-y-1"
            aria-label="Play audio"
          >
            🔊
          </button>
          <button
            onClick={() => void playItemAudio(item.id, true)}
            className="h-20 w-20 rounded-3xl bg-card border-2 border-b-8 border-line text-3xl transition-all active:border-b-2 active:translate-y-1"
            aria-label="Play slowly"
          >
            🐢
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {choices.map((c) => {
          const isSel = selected === c.id;
          const showState = phase === 'feedback' && (isSel || c.id === item.id);
          const stateCls = showState
            ? c.id === item.id
              ? 'border-success bg-success-soft'
              : 'border-error bg-error-soft'
            : isSel
              ? 'border-teal ring-2 ring-teal/30'
              : 'border-line hover:border-teal/40';
          return (
            <button
              key={c.id}
              disabled={phase === 'feedback'}
              onClick={() => select(c.id)}
              className={`rounded-2xl border-2 border-b-4 bg-card px-4 py-3 text-left font-bold transition-all ${stateCls}`}
            >
              {isScript && (ex.kind === 'mc-en2te' || ex.kind === 'listen-pick') ? (
                <span className="te-script block text-center text-3xl font-extrabold">{c.te}</span>
              ) : (
                <>
                  {choiceLabel(ex.kind, c)}
                  {(ex.kind === 'mc-en2te' || ex.kind === 'listen-pick') && scriptMode !== 'roman' && (
                    <span className="te-script block text-sm font-semibold text-ink-soft">{c.te}</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function choiceLabel(kind: ChoiceExercise['kind'], c: ContentItem): string {
  return kind === 'mc-te2en' || kind === 'mc-audio' ? c.gloss : c.roman;
}
