// Audio: lesson clip playback (pre-rendered m4a) + WebAudio sound effects.

import { audioFileFor } from './content/load';
import { DEFAULT_VOICE, otherVoice, type VoiceId } from './content/voices';
import { platform } from './platform';

let activeVoice: VoiceId = DEFAULT_VOICE;
/** The learner's chosen voice (set by the store when the profile loads or changes). */
export function setActiveVoice(v: VoiceId): void {
  activeVoice = v;
}
export function getActiveVoice(): VoiceId {
  return activeVoice;
}
let current: HTMLAudioElement | null = null;
let currentSource: AudioBufferSourceNode | null = null;

// Decoded clips. Playing through WebAudio (not <audio>) keeps iOS from
// treating a one-second phrase as "media": no Now Playing card on the lock
// screen, no play/pause widget in Control Center.
const bufferCache = new Map<string, Promise<AudioBuffer>>();
const BUFFER_CACHE_MAX = 240;

function decodedClip(url: string): Promise<AudioBuffer> {
  let p = bufferCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`clip ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx().decodeAudioData(bytes));
    p.catch(() => bufferCache.delete(url));
    bufferCache.set(url, p);
    if (bufferCache.size > BUFFER_CACHE_MAX) bufferCache.delete(bufferCache.keys().next().value!);
  }
  return p;
}

/** Play a decoded buffer at VOICE_VOLUME; resolves when it ends (or is stopped). */
// Bumped whenever the reference voice is stopped or a new clip is asked for.
// A clip that was still decoding (or waiting on the audio context) when that
// happened checks it and stays silent — otherwise it would start late, over
// the next card or into the learner's recording.
let playToken = 0;

async function playBuffer(buffer: AudioBuffer, rate = 1, token = playToken): Promise<void> {
  const c = ctx();
  // iOS suspends the context between gestures and after interruptions (a call,
  // Siri, the lock screen); a card's autoplay runs outside any gesture, so
  // wait for the resume instead of starting into a frozen clock
  if (c.state !== 'running') await c.resume().catch(() => {});
  if (token !== playToken) return;
  return new Promise((resolve) => {
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = VOICE_VOLUME;
    src.connect(g).connect(c.destination);
    src.onended = () => {
      if (currentSource === src) currentSource = null;
      resolve();
    };
    currentSource = src;
    src.start();
  });
}

/**
 * Warm the decode cache for the clips a screen is about to use (a game round, a
 * dialogue), so the first tap plays instantly and offline-cached clips decode
 * ahead of time. Failures are ignored; playback has its own fallbacks.
 */
export function preloadItemAudio(itemIds: readonly string[], voice: VoiceId = activeVoice): void {
  for (const id of itemIds) decodedClip(audioFileFor(id, voice)).catch(() => {});
}

/**
 * A clip's samples as 16 kHz mono floats, for grading a take by ear against the
 * native recording (engine/speech/acoustic). Decoded once per clip, resampled
 * with the browser's own audio engine.
 */
export async function loadClipPcm16k(itemId: string, voice: VoiceId = activeVoice): Promise<Float32Array> {
  const buf = await decodedClip(audioFileFor(itemId, voice));
  const mono = buf.getChannelData(0);
  if (buf.sampleRate === 16000) return Float32Array.from(mono);
  const frames = Math.ceil((mono.length * 16000) / buf.sampleRate);
  const off = new OfflineAudioContext(1, frames, 16000);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return Float32Array.from(rendered.getChannelData(0));
}

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
  playToken++;
  current?.pause();
  current = null;
  try {
    currentSource?.stop();
  } catch {
    /* already ended */
  }
  currentSource = null;
}

/** Play an item's pre-rendered audio in the chosen voice (or a specific one). slow=true stretches to 0.72x. */
export function playItemAudio(itemId: string, slow = false, voice: VoiceId = activeVoice): Promise<void> {
  return new Promise((resolve) => {
    const start = (v: VoiceId, onFail: () => void) => {
      stopItemAudio();
      const token = playToken;
      const url = audioFileFor(itemId, v);
      // where <audio> cannot play the clip (some iOS versions refuse media
      // served from the offline cache), slow it through Web Audio instead:
      // the pitch drops a little, but the turtle button always does something
      const slowViaBuffer = () =>
        decodedClip(url).then(
          (buf) => (token === playToken ? playBuffer(buf, 0.72, token).then(resolve) : resolve()),
          () => onFail(),
        );
      if (slow) {
        // slow mode needs pitch-preserving time stretch, which only <audio> offers
        const el = new Audio(url);
        current = el;
        el.volume = VOICE_VOLUME;
        el.playbackRate = 0.72;
        if ('preservesPitch' in el) (el as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
        el.onended = () => resolve();
        let fellBack = false;
        const fallBack = () => {
          if (fellBack) return;
          fellBack = true;
          if (current === el) current = null;
          if (token === playToken) void slowViaBuffer();
          else resolve();
        };
        el.onerror = fallBack;
        void el.play().catch((err: unknown) => {
          // pausing it ourselves (the learner moved on) is not a failure
          if (err instanceof DOMException && err.name === 'AbortError') resolve();
          else fallBack();
        });
        return;
      }
      decodedClip(url).then(
        (buf) => (token === playToken ? playBuffer(buf, 1, token).then(resolve) : resolve()),
        () => (token === playToken ? onFail() : resolve()),
      );
    };
    // a clip missing in one voice falls back to the other, then to live TTS (desktop)
    start(voice, () => start(otherVoice(voice), () => void fallbackSpeak(itemId).finally(resolve)));
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

export async function playWavBytes(wav: ArrayBuffer): Promise<void> {
  try {
    const buf = await ctx().decodeAudioData(wav.slice(0));
    await playBuffer(buf);
  } catch {
    /* undecodable: stay silent rather than crash the exercise */
  }
}

/** Play a short recording (e.g. the learner's own take) without a media session. */
export async function playUrl(url: string): Promise<void> {
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const buf = await ctx().decodeAudioData(bytes);
    await playBuffer(buf);
  } catch {
    /* ignore */
  }
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

// iOS Safari (and the installed PWA) only lets a context start inside a user
// gesture, and it suspends again after an interruption. The first tap anywhere
// creates the context, resumes it and plays one silent frame; later gestures
// re-resume it when needed, so lesson cards that autoplay after a pause are
// never silent on the phone.
function unlockAudio(): void {
  const c = ctx();
  if (c.state === 'running') return;
  void c.resume().catch(() => {});
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* a context that refuses a silent frame will still resume on the next gesture */
  }
}
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'touchend', 'keydown'] as const) {
    window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sfxCtx && sfxCtx.state !== 'running') {
      void sfxCtx.resume().catch(() => {});
    }
  });
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
  /** coins landing: bright, short, two-note clink */
  coin(): void {
    if (!sfxEnabled) return;
    tone(1568, 0, 0.08, 'sine', 0.08);
    tone(2093, 0.07, 0.16, 'sine', 0.07);
  },
};
