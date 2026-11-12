// Word-bank sentence building: tap roman tiles into order.

import { useEffect, useState } from 'react';
import { Card } from '../../components/ui';
import { playItemAudio } from '../../audio';
import type { WordbankExercise } from '../../engine/types';
import type { ExerciseProps } from './shared';
import { RevealGloss } from './shared';

interface Tile {
  key: number;
  word: string;
}

export function Wordbank({ exercise, item, unit, phase, onReady, scriptMode }: ExerciseProps) {
  const ex = exercise as WordbankExercise;
  const isScript = unit.track === 'script';
  const [placed, setPlaced] = useState<Tile[]>([]);
  const [bank, setBank] = useState<Tile[]>([]);

  useEffect(() => {
    setPlaced([]);
    setBank(ex.tiles.map((word, key) => ({ key, word })));
    onReady(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  const expected = item.words.map((w) => (isScript ? w.te : w.roman));

  useEffect(() => {
    if (placed.length === 0) {
      onReady(null);
      return;
    }
    onReady(() => {
      const got = placed.map((t) => t.word);
      const correct =
        got.length === expected.length && got.every((w, i) => w.toLowerCase() === expected[i].toLowerCase());
      return { correct, expected: expected.join(' '), got: got.join(' ') };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  const place = (tile: Tile) => {
    if (phase !== 'answering') return;
    setBank((b) => b.filter((t) => t.key !== tile.key));
    setPlaced((p) => [...p, tile]);
  };
  const unplace = (tile: Tile) => {
    if (phase !== 'answering') return;
    setPlaced((p) => p.filter((t) => t.key !== tile.key));
    setBank((b) => [...b, tile].sort((a, z) => a.key - z.key));
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-extrabold">{!isScript ? 'Build the sentence' : /\s/.test(item.te.trim()) ? 'Put them in order' : 'Build the word'}</h2>
      <Card className="py-5 text-center">
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => void playItemAudio(item.id)} className="text-2xl active:scale-90" aria-label="Play">
              🔊
            </button>
            {!isScript && <div className="text-xl font-extrabold text-teal">{item.gloss}</div>}
          </div>
          {isScript ? (
            <RevealGloss gloss={item.gloss} />
          ) : (
            scriptMode !== 'roman' && <div className="te-script text-ink-soft">{item.te}</div>
          )}
        </div>
      </Card>

      <div className="min-h-16 rounded-2xl border-2 border-dashed border-line bg-card/50 p-3">
        <div className="flex flex-wrap gap-2">
          {placed.map((t) => (
            <button
              key={t.key}
              onClick={() => unplace(t)}
              className={`rounded-xl border-2 border-b-4 border-teal bg-teal-soft px-3 py-2 font-extrabold text-teal animate-pop ${isScript ? 'te-script text-2xl' : ''}`}
            >
              {t.word}
            </button>
          ))}
          {placed.length === 0 && <span className="font-semibold text-ink-soft px-1 py-2">{isScript ? 'Tap the tiles below…' : 'Tap the words below…'}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {bank.map((t) => (
          <button
            key={t.key}
            onClick={() => place(t)}
            className={`rounded-xl border-2 border-b-4 border-line bg-card px-3 py-2 font-extrabold transition-all hover:border-teal/50 ${isScript ? 'te-script text-2xl' : ''}`}
          >
            {t.word}
          </button>
        ))}
      </div>
    </div>
  );
}
