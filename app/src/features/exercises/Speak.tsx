// Speaking exercise. Desktop: record → whisper → word-level feedback.
// Web/PWA: echo mode — record, compare by ear against the reference, self-grade.

import { useEffect, useState } from 'react';
import { platform } from '../../platform';
import { mic, type Recording } from '../../platform/recorder';
import { playItemAudio, playUrl, stopItemAudio } from '../../audio';
import { scoreSpeechCalibrated } from '../../engine/speech/align';
import referenceTranscripts from '../../content/reference-transcripts.json';
import type { SpeakResult } from '../../engine/types';
import { Button, Card } from '../../components/ui';
import type { ExerciseProps } from './shared';
import { SentenceDisplay } from './shared';

const REFS = referenceTranscripts as Record<string, string>;

type Mode = 'loading' | 'asr' | 'echo';
type Stage = 'idle' | 'recording' | 'scoring' | 'result';

export function Speak({ exercise, item, scriptMode, onAutoResult, onReady }: ExerciseProps) {
  const [mode, setMode] = useState<Mode>('loading');
  const [stage, setStage] = useState<Stage>('idle');
  const [take, setTake] = useState<Recording | null>(null);
  const [result, setResult] = useState<SpeakResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [echoWhy, setEchoWhy] = useState<'unpaired' | 'offline' | null>(null);
  useEffect(() => {
    setStage('idle');
    setTake(null);
    setResult(null);
    setError(null);
    onReady(null);
    void platform.asrAvailable().then(async (ok) => {
      setMode(ok ? 'asr' : 'echo');
      if (!ok && platform.kind === 'web') {
        const { sync } = await import('../../sync');
        setEchoWhy(sync.endpoint && sync.key ? 'offline' : 'unpaired');
      }
    });
    // Let the card settle on screen for a beat before the voice speaks — it reads
    // as a native pause instead of a clip cutting in the instant the page changes.
    const autoplay = window.setTimeout(() => void playItemAudio(item.id), 900);
    // shared mic: cancel parks the take but keeps the stream, so iOS only
    // asks for permission once per session. Desktop never re-prompts, so it
    // releases fully (no lingering mic-in-use indicator).
    return () => {
      window.clearTimeout(autoplay);
      stopItemAudio();
      mic.cancel();
      if (platform.kind !== 'web') mic.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  const startRec = async () => {
    setError(null);
    stopItemAudio(); // never let the reference voice bleed into the learner's take
    try {
      await mic.start();
      setStage('recording');
    } catch {
      setError('Microphone unavailable. Check permissions in System Settings.');
    }
  };

  const stopRec = async () => {
    if (!mic.recording) return;
    const rec = await mic.stop();
    setTake(rec);
    if (rec.durationSec < 0.35) {
      setStage('idle');
      setError("That was too short — tap, say the phrase, then tap again.");
      return;
    }
    if (mode === 'asr') {
      setStage('scoring');
      const res = await platform.transcribe(rec.wav);
      if (!res.ok) {
        if (platform.kind === 'web') {
          // can't reach the scorer — degrade to echo self-grading, but SAY so
          setEchoWhy(res.error?.includes('Pair sync') ? 'unpaired' : 'offline');
          setMode('echo');
          setStage('result');
          return;
        }
        setError(res.error ?? 'Could not analyze that — try again.');
        setStage('idle');
        return;
      }
      const scored = scoreSpeechCalibrated(item.te, res.text, REFS[item.id]);
      setResult(scored);
      setStage('result');
      onAutoResult({ correct: scored.pass, expected: item.roman, got: scored.transcriptRoman || '(nothing heard)' });
    } else {
      setStage('result');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-extrabold">Say it out loud</h2>
      <Card className="flex flex-col items-center gap-2 py-6">
        <button onClick={() => void playItemAudio(item.id)} className="text-2xl active:scale-90" aria-label="Play">
          🔊
        </button>
        <SentenceDisplay item={item} scriptMode={scriptMode} />
        <div className="font-semibold text-teal">{item.gloss}</div>
      </Card>

      {mode === 'echo' && stage !== 'result' && (
        <p className="text-center text-sm font-semibold text-ink-soft">
          Echo practice: record yourself, then compare with the reference.
          {echoWhy === 'unpaired' && (
            <span className="mt-1 block font-bold text-marigold-dark">
              Want AI word-by-word grading? Settings → 🔄 Sync → pair with your Mac (one time).
            </span>
          )}
          {echoWhy === 'offline' && (
            <span className="mt-1 block">AI grading resumes when you're back online.</span>
          )}
        </p>
      )}

      {(stage === 'idle' || stage === 'recording') && (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => (stage === 'recording' ? void stopRec() : void startRec())}
            onContextMenu={(e) => e.preventDefault()}
            className={`no-callout h-24 w-24 rounded-full border-b-8 text-4xl text-white transition-all active:border-b-2 active:translate-y-1 ${
              stage === 'recording' ? 'bg-error border-error-dark animate-pulse' : 'bg-flame border-[#c93c1e]'
            }`}
            style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
            aria-label={stage === 'recording' ? 'Recording — tap to stop' : 'Tap to record'}
          >
            {stage === 'recording' ? '⏹' : '🎤'}
          </button>
          <p className="font-bold text-ink-soft">
            {stage === 'recording' ? 'Listening… tap when done' : 'Tap, speak, tap again'}
          </p>
          {error && <p className="font-semibold text-error">{error}</p>}
        </div>
      )}

      {stage === 'scoring' && (
        <div className="flex flex-col items-center gap-2 py-4">
          <div className="text-3xl animate-bounce">🦜</div>
          <p className="font-bold text-ink-soft">Chikki is listening…</p>
        </div>
      )}

      {stage === 'result' && mode === 'asr' && result && (
        <div className="flex flex-col gap-3 animate-pop">
          <div className="flex flex-wrap justify-center gap-2">
            {result.words.map((w, i) => (
              <span
                key={i}
                className={`rounded-xl border-2 px-3 py-1.5 font-extrabold ${
                  w.pass
                    ? 'border-success bg-success-soft text-success-dark'
                    : w.similarity >= 0.45
                      ? 'border-marigold bg-amber-soft text-marigold-dark'
                      : 'border-error bg-error-soft text-error-dark'
                }`}
                title={w.said ? `heard: ${w.said}` : 'not heard'}
              >
                {w.target}
              </span>
            ))}
          </div>
          <p className="text-center font-semibold text-ink-soft">
            Chikki heard: <span className="font-extrabold text-ink">{result.transcriptRoman || '—'}</span>
          </p>
          <div className="flex justify-center gap-3">
            {take && (
              <Button variant="ghost" onClick={() => void playUrl(take.url)}>
                ▶ Your take
              </Button>
            )}
            <Button variant="ghost" onClick={() => void playItemAudio(item.id)}>
              🔊 Reference
            </Button>
            <Button variant="ghost" onClick={() => setStage('idle')}>
              🎤 Retry
            </Button>
          </div>
          {!result.pass && (
            <button
              className="mx-auto text-sm font-bold text-teal underline underline-offset-2"
              onClick={() => onAutoResult({ correct: true, expected: item.roman, override: true })}
            >
              I said it right — the mic misheard me
            </button>
          )}
        </div>
      )}

      {stage === 'result' && mode === 'echo' && take && (
        <div className="flex flex-col gap-4 animate-pop">
          <div className="flex justify-center gap-3">
            <Button variant="ghost" onClick={() => void playUrl(take.url)}>
              ▶ Your take
            </Button>
            <Button variant="ghost" onClick={() => void playItemAudio(item.id)}>
              🔊 Reference
            </Button>
            <Button variant="ghost" onClick={() => setStage('idle')}>
              🎤 Retry
            </Button>
          </div>
          <p className="text-center font-bold">How close were you?</p>
          <div className="flex justify-center gap-3">
            <Button variant="success" onClick={() => onAutoResult({ correct: true })}>
              Nailed it
            </Button>
            <Button variant="secondary" onClick={() => onAutoResult({ correct: true })}>
              Close
            </Button>
            <Button variant="danger" onClick={() => onAutoResult({ correct: false, expected: item.roman })}>
              Again later
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
