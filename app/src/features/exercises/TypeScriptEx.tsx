// Writing exercise: hear the word (and optionally peek at the meaning), then
// WRITE it in Telugu script with the system Telugu keyboard. The question
// shows Telugu-side information only — English is behind a reveal.

import { useEffect, useRef, useState } from 'react';
import { playItemAudio, playItemAudioAfterPause } from '../../audio';
import { Card } from '../../components/ui';
import type { ExerciseProps } from './shared';
import { RevealGloss } from './shared';
import { KeyboardHelp } from './KeyboardHelp';

/** Compare typed Telugu with the target: NFC, ignore spaces/punctuation. */
export function scriptMatches(input: string, target: string): boolean {
  const clean = (s: string) => s.normalize('NFC').replace(/[\s.,!?'"‘’“”\-–]/gu, '');
  return clean(input).length > 0 && clean(input) === clean(target);
}

export function TypeScriptEx({ exercise, item, phase, onReady }: ExerciseProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText('');
    onReady(null);
    const cancel = playItemAudioAfterPause(item.id);
    inputRef.current?.focus();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      onReady(null);
      return;
    }
    onReady(() => ({
      correct: scriptMatches(trimmed, item.te),
      expected: item.te,
      got: trimmed,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-extrabold">Write it in Telugu</h2>
      <Card className="flex flex-col items-center gap-3 py-6">
        <div className="flex justify-center gap-4">
          <button
            onClick={() => void playItemAudio(item.id)}
            className="h-16 w-16 rounded-3xl bg-teal border-b-8 border-teal-dark text-3xl text-white transition-all active:border-b-2 active:translate-y-1"
            aria-label="Play audio"
          >
            🔊
          </button>
          <button
            onClick={() => void playItemAudio(item.id, true)}
            className="h-16 w-16 rounded-3xl bg-card border-2 border-b-8 border-line text-2xl transition-all active:border-b-2 active:translate-y-1"
            aria-label="Play slowly"
          >
            🐢
          </button>
        </div>
        <RevealGloss gloss={item.gloss} />
      </Card>
      <textarea
        ref={inputRef}
        value={text}
        disabled={phase === 'feedback'}
        onChange={(e) => setText(e.target.value)}
        placeholder="టైప్ చేయండి…"
        rows={2}
        lang="te"
        className="te-script rounded-2xl border-2 border-line bg-card px-4 py-3 text-2xl font-semibold outline-none focus:border-teal resize-none text-center"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <KeyboardHelp compact />
    </div>
  );
}
