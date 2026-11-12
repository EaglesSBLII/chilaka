// Intro card: teach a new item — sentence, meaning, word breakdown, audio.

import { useEffect } from 'react';
import { Card } from '../../components/ui';
import { Mascot } from '../../components/Mascot';
import { playItemAudio, playItemAudioAfterPause } from '../../audio';
import { aksharaCount } from '../../engine/trace';
import type { ExerciseProps } from './shared';
import { RevealGloss, SentenceDisplay } from './shared';

export function Intro({ item, unit, scriptMode, onAutoResult, phase }: ExerciseProps) {
  const isScript = unit.track === 'script';
  useEffect(() => {
    const cancel = playItemAudioAfterPause(item.id);
    // intro is always "correct" — it just needs a CONTINUE
    onAutoResult({ correct: true });
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Mascot pose="teach" size={64} />
        <h2 className="text-xl font-extrabold">
          {!isScript || /\s/.test(item.te.trim()) ? 'New phrase!' : aksharaCount(item.te) === 1 ? 'New letter!' : 'New word!'}
        </h2>
      </div>
      <Card className="flex flex-col items-center gap-3 py-8">
        <button
          onClick={() => void playItemAudio(item.id)}
          className="text-3xl transition-transform active:scale-90"
          aria-label="Play audio"
        >
          🔊
        </button>
        {isScript ? (
          <>
            <div className="te-script text-6xl font-extrabold text-ink">{item.te}</div>
            <div className="text-lg font-bold text-ink-soft">{item.roman}</div>
            <RevealGloss gloss={item.gloss} />
          </>
        ) : (
          <>
            <SentenceDisplay item={item} scriptMode={scriptMode} size="text-3xl" />
            <div className="text-xl font-semibold text-teal">{item.gloss}</div>
          </>
        )}
      </Card>
      <div className="flex flex-wrap justify-center gap-2">
        {item.words.map((w, i) => (
          <div key={i} className="rounded-xl border-2 border-line bg-card px-3 py-2 text-center">
            <div className={isScript ? 'te-script text-2xl font-extrabold' : 'font-extrabold'}>
              {isScript ? w.te : w.roman}
            </div>
            <div className="text-xs font-semibold text-ink-soft">{w.gloss}</div>
          </div>
        ))}
      </div>
      {item.note && phase === 'answering' && (
        <div className="rounded-2xl border-2 border-marigold/50 bg-amber-soft px-4 py-3 text-sm font-semibold">
          💡 {item.note}
        </div>
      )}
    </div>
  );
}
