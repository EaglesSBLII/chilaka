// Speaking exercise. Desktop: record → whisper → word-level feedback.
// Web/PWA: echo mode — record, compare by ear against the reference, self-grade.

import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { platform } from '../../platform';
import { mic, type Recording } from '../../platform/recorder';
import { getActiveVoice, playItemAudio, playItemAudioAfterPause, playUrl, stopItemAudio } from '../../audio';
import { scoreSpeechCalibrated, transcriptLooksUnreliable } from '../../engine/speech/align';
import { asrHintFor } from '../../engine/speech/hint';
import { unitById } from '../../content/load';
import { useApp } from '../../store';
import refsFemale from '../../content/reference-transcripts-female.json';
import refsMale from '../../content/reference-transcripts-male.json';
import webRefsFemale from '../../content/reference-transcripts-web-female.json';
import webRefsMale from '../../content/reference-transcripts-web-male.json';
import type { SpeakResult } from '../../engine/types';
import type { EarVerdict } from '../../engine/speech/acoustic';
import { earFirst, gradeTakeByEar, warmEar } from './ear';
import { Button, Card } from '../../components/ui';
import type { ExerciseProps } from './shared';
import { SentenceDisplay } from './shared';

// What the recognizer hears in each voice's own reference clip — calibration per
// voice AND per recognizer: the Mac grades with whisper medium (Telugu GGML),
// the phone with Workers AI whisper-large-v3-turbo, and they mishear
// differently. Items not yet measured for the web fall back to the Mac set.
const DESKTOP_REFS: Record<string, Record<string, string>> = { female: refsFemale, male: refsMale };
const WEB_REFS: Record<string, Record<string, string>> = { female: webRefsFemale, male: webRefsMale };
function referenceTranscript(itemId: string): string | undefined {
  const voice = getActiveVoice();
  if (platform.kind === 'web') return WEB_REFS[voice]?.[itemId] ?? DESKTOP_REFS[voice]?.[itemId];
  return DESKTOP_REFS[voice]?.[itemId];
}

// 'ear': the take is matched against the native clip (web, short phrases)
type Mode = 'loading' | 'asr' | 'ear' | 'echo';
type Stage = 'idle' | 'recording' | 'scoring' | 'result';

export function Speak({ exercise, item, unit, scriptMode, onAutoResult, onReady }: ExerciseProps) {
  const [mode, setMode] = useState<Mode>('loading');
  const [stage, setStage] = useState<Stage>('idle');
  const [take, setTake] = useState<Recording | null>(null);
  const [result, setResult] = useState<SpeakResult | null>(null);
  const [ear, setEar] = useState<EarVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [echoWhy, setEchoWhy] = useState<'unpaired' | 'offline' | null>(null);
  const [micTip, setMicTip] = useState<string | null>(null);
  const cancelAutoplayRef = useRef<() => void>(() => {});
  useEffect(() => {
    setStage('idle');
    setTake(null);
    setResult(null);
    setEar(null);
    setError(null);
    setMicTip(null);
    onReady(null);
    if (earFirst(item)) {
      // short phrase on the web: judged against the native clip, online or off
      setMode('ear');
      warmEar(item, unit);
    } else {
      void platform.asrAvailable().then(async (ok) => {
        setMode(ok ? 'asr' : 'echo');
        if (!ok && platform.kind === 'web') {
          const { sync } = await import('../../sync');
          setEchoWhy(sync.endpoint && sync.key ? 'offline' : 'unpaired');
        }
      });
      if (platform.kind === 'web') warmEar(item, unit); // second opinion for longer phrases
    }
    // Let the card settle on screen for a beat before the voice speaks.
    const cancelAutoplay = playItemAudioAfterPause(item.id);
    cancelAutoplayRef.current = cancelAutoplay;
    // shared mic: cancel parks the take but keeps the stream, so iOS only
    // asks for permission once per session. Desktop never re-prompts, so it
    // releases fully (no lingering mic-in-use indicator).
    return () => {
      cancelAutoplay();
      mic.cancel();
      if (platform.kind !== 'web') mic.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  const startRec = async () => {
    setError(null);
    // never let the reference voice bleed into the learner's take: stop what is
    // playing AND the card's pending autoplay (tapping the mic at once used to
    // let it start mid-recording)
    cancelAutoplayRef.current();
    stopItemAudio();
    try {
      await mic.start();
      if (!mic.recording) return; // the card was left while the mic was opening
      setStage('recording');
    } catch {
      setError('Microphone unavailable. Check permissions in System Settings.');
    }
  };

  const stopRec = async () => {
    if (!mic.recording) return;
    const rec = await mic.stop();
    setTake(rec);
    if (rec.quality.silent) {
      setStage('idle');
      setError("Didn't hear anything — check the mic isn't muted, then try again.");
      return;
    }
    if (rec.durationSec < 0.35) {
      setStage('idle');
      setError("That was too short — tap, say the phrase, then tap again.");
      return;
    }
    if (rec.quality.quiet) setMicTip('That came through faintly — a little closer to the mic helps.');
    else if (rec.quality.clipped > 0.005) setMicTip('A touch loud for the mic — ease back a little.');
    else setMicTip(null);
    if (mode === 'ear') {
      setStage('scoring');
      const verdict = await gradeTakeByEar(rec.wav, item, unit);
      if (!verdict) {
        // clips not available (first offline run): fall back to echo self-grading
        setEchoWhy('offline');
        setMode('echo');
        setStage('result');
        return;
      }
      setEar(verdict);
      setStage('result');
      const correct = verdict.pass || verdict.close;
      if (correct) void useApp.getState().recordSpeak();
      onAutoResult({ correct, expected: item.roman, got: correct ? item.roman : '(did not sound like it)' });
      return;
    }
    if (mode === 'asr') {
      setStage('scoring');
      let res = await platform.transcribe(rec.wav, { prompt: asrHintFor(item, unitById(item.id.split('-')[0])) });
      if (res.ok && transcriptLooksUnreliable(item.te, res.text)) {
        // the recognizer ran away with the lesson prompt — once more without it
        const plain = await platform.transcribe(rec.wav, {});
        if (plain.ok) res = plain;
      }
      if (res.ok && transcriptLooksUnreliable(item.te, res.text)) {
        // still nonsense: on the web let the ear decide, otherwise ask for another take
        const verdict = platform.kind === 'web' ? await gradeTakeByEar(rec.wav, item, unit) : null;
        if (verdict) {
          setEar(verdict);
          setMode('ear');
          setStage('result');
          const correct = verdict.pass || verdict.close;
          if (correct) void useApp.getState().recordSpeak();
          onAutoResult({ correct, expected: item.roman, got: correct ? item.roman : '(did not sound like it)' });
          return;
        }
        setStage('idle');
        setError("Chikki couldn't make that out — try once more, a little closer to the mic.");
        return;
      }
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
      let scored = scoreSpeechCalibrated(item.te, res.text, referenceTranscript(item.id));
      if (!scored.pass && platform.kind === 'web') {
        // the phone's recogniser mishears short Telugu; a take that sounds like
        // the native clip passes even when the transcript does not
        const verdict = await gradeTakeByEar(rec.wav, item, unit);
        if (verdict?.pass) scored = { ...scored, pass: true };
      }
      setResult(scored);
      setStage('result');
      if (scored.pass) void useApp.getState().recordSpeak();
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
            className={`no-callout flex h-24 w-24 items-center justify-center rounded-full text-white shadow-float transition-transform active:scale-95 ${
              stage === 'recording' ? 'btn-error animate-pulse ring-8 ring-error/20' : 'btn-error'
            }`}
            style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
            aria-label={stage === 'recording' ? 'Recording — tap to stop' : 'Tap to record'}
          >
            {stage === 'recording' ? <Square size={34} className="fill-white" /> : <Mic size={40} strokeWidth={2.4} />}
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
          {micTip && <p className="text-center text-sm font-semibold text-marigold-dark">{micTip}</p>}
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

      {stage === 'result' && mode === 'ear' && ear && (
        <div className="flex flex-col gap-3 animate-pop" data-testid="ear-result" data-pass={ear.pass || ear.close ? 'true' : 'false'}>
          <div className="flex justify-center">
            <span
              className={`rounded-xl border-2 px-4 py-2 text-lg font-extrabold ${
                ear.pass
                  ? 'border-success bg-success-soft text-success-dark'
                  : ear.close
                    ? 'border-marigold bg-amber-soft text-marigold-dark'
                    : 'border-error bg-error-soft text-error-dark'
              }`}
            >
              {item.roman}
            </span>
          </div>
          <p className="text-center font-semibold text-ink-soft">
            {ear.pass
              ? 'Chikki heard it — that sounds right!'
              : ear.close
                ? 'Close! Listen once more and say it again.'
                : ear.lengthMismatch
                  ? 'That was a different length from the phrase — listen and try again.'
                  : 'Not quite — listen to the reference and try again.'}
          </p>
          {micTip && <p className="text-center text-sm font-semibold text-marigold-dark">{micTip}</p>}
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
          {!ear.pass && !ear.close && (
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
