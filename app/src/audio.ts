// Audio: lesson clip playback (pre-rendered m4a) + WebAudio sound effects.

import { audioFileFor } from './content/load';
import { platform } from './platform';
let current: HTMLAudioElement | null = null;

/** Playback level for the AI voice (reference clips and live TTS). 1 = full. */
export const VOICE_VOLUME = 0.55;

/**
 * Pause before the voice speaks when a card appears. Every lesson type (speaking,
 * reading, writing, dialogues) waits this long after the page changes, so the
 * phrase reads as a teacher taking a breath rather than a clip cutting in.
 */
export const VOICE_LEAD_MS = 900;

/**
 * Play an item's clip after the standard lead-in pause. Returns a cancel function
 * for the exercise's cleanup: it clears the pending play and stops the clip if it
 * already started, so leaving a card never leaves a voice talking over the next.
 */
export function playItemAudioAfterPause(itemId: string, slow = false): () => void {
  const t = window.setTimeout(() => void playItemAudio(itemId, slow), VOICE_LEAD_MS);
  return () => {
    window.clearTimeout(t);
    stopItemAudio();
  };
}

/** Stop the reference clip (used when the learner starts recording, so the mic never hears it). */
export function stopItemAudio(): void {
  current?.pause();
  current = null;
}

/** Play an item's pre-rendered audio. slow=true stretches to 0.72x. */
export function playItemAudio(itemId: string, slow = false): Promise<void> {
  return new Promise((resolve) => {
    current?.pause();
    const el = new Audio(audioFileFor(itemId));
    current = el;
    el.volume = VOICE_VOLUME;
    el.playbackRate = slow ? 0.72 : 1;
    if ('preservesPitch' in el) (el as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
    el.onended = () => resolve();
    el.onerror = () => {
      // Missing clip → try live TTS (desktop), else resolve silently.
      void fallbackSpeak(itemId).finally(resolve);
    };
    void el.play().catch(() => resolve());
  });
}

async function fallbackSpeak(itemId: string): Promise<void> {
  const { itemById } = await import('./content/load');
  const item = itemById(itemId);
  if (!item) return;
  const wav = await platform.speak(item.te);
  if (!wav) return;
  await playWavBytes(wav);
}

export function playWavBytes(wav: ArrayBuffer): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const el = new Audio(url);
    el.volume = VOICE_VOLUME;
    el.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    void el.play().catch(() => resolve());
  });
}

export function playUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const el = new Audio(url);
    el.onended = () => resolve();
    el.onerror = () => resolve();
    void el.play().catch(() => resolve());
  });
}

// ---- SFX: tiny synthesized cues, no asset files ----

let sfxCtx: AudioContext | null = null;
let sfxEnabled = true;

export function setSfxEnabled(on: boolean): void {
  sfxEnabled = on;
}

function ctx(): AudioContext {
  if (!sfxCtx) sfxCtx = new AudioContext();
  return sfxCtx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12): void {
  const c = ctx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.05);
}

export const sfx = {
  correct(): void {
    if (!sfxEnabled) return;
    tone(660, 0, 0.12, 'triangle');
    tone(880, 0.09, 0.18, 'triangle');
  },
  wrong(): void {
    if (!sfxEnabled) return;
    tone(220, 0, 0.2, 'sawtooth', 0.06);
    tone(180, 0.12, 0.25, 'sawtooth', 0.06);
  },
  complete(): void {
    if (!sfxEnabled) return;
    tone(523, 0, 0.12, 'triangle');
    tone(659, 0.1, 0.12, 'triangle');
    tone(784, 0.2, 0.12, 'triangle');
    tone(1046, 0.3, 0.3, 'triangle');
  },
  tick(): void {
    if (!sfxEnabled) return;
    tone(880, 0, 0.05, 'sine', 0.05);
  },
  fanfare(): void {
    if (!sfxEnabled) return;
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.09, 0.25, 'triangle', 0.1));
  },
};
