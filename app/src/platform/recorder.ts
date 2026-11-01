// Microphone capture → 16 kHz mono 16-bit WAV. Shared by desktop (feeds
// whisper) and iPhone echo mode (feeds playback). Background music pauses
// automatically for the duration of a recording.

import { music } from '../music';

export interface Recording {
  wav: ArrayBuffer;
  durationSec: number;
  /** object URL for instant playback of the take */
  url: string;
}

const TARGET_RATE = 16000;

export class MicRecorder {
  // Stream + context persist across takes: releasing the mic between takes
  // makes iOS standalone PWAs re-prompt for permission on every recording.
  // Holding the (muted) stream means ONE prompt per app session.
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private highpass: BiquadFilterNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = TARGET_RATE;
  recording = false;

  private async ensureStream(): Promise<MediaStream> {
    // iOS ends held tracks when the app is backgrounded — re-acquire then
    const live = this.stream?.getTracks().every((t) => t.readyState === 'live');
    if (this.stream && live) return this.stream;
    this.teardown();
    // RAW capture: echoCancellation/noiseSuppression flip iOS into 'voice
    // call' processing — band-limited, muffled audio that tanks recognition.
    // We don't need AEC (music/lesson audio is paused while recording).
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    return this.stream;
  }

  async start(): Promise<void> {
    if (this.recording) return;
    music.duck(true); // silence background music while the mic is open
    const stream = await this.ensureStream();
    stream.getTracks().forEach((t) => (t.enabled = true));
    if (!this.ctx) {
      // Ask for 16 kHz directly; browsers that refuse give us their rate and
      // we resample on stop().
      try {
        this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
      } catch {
        this.ctx = new AudioContext();
      }
      this.sampleRate = this.ctx.sampleRate;
      this.source = this.ctx.createMediaStreamSource(stream);
      // gentle high-pass: kills handling rumble + the record-tap thump
      // without touching the voice band
      this.highpass = this.ctx.createBiquadFilter();
      this.highpass.type = 'highpass';
      this.highpass.frequency.value = 70;
      this.highpass.Q.value = 0.7;
      this.source.connect(this.highpass);
    }
    // iOS creates contexts suspended even inside a user gesture — without an
    // explicit resume the processor receives only silence
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }
    // ScriptProcessor is deprecated but universally supported (incl. iOS
    // Safari) and fine for short utterances.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.processor.onaudioprocess = (e) => {
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.highpass!.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this.recording = true;
  }

  /** Mute + detach after a take, but KEEP the stream/context for the session. */
  private park(): void {
    if (this.processor) {
      this.processor.disconnect();
      try {
        this.highpass?.disconnect(this.processor);
      } catch {
        // already detached
      }
      this.processor = null;
    }
    this.stream?.getTracks().forEach((t) => (t.enabled = false));
    void this.ctx?.suspend().catch(() => {});
  }

  async stop(): Promise<Recording> {
    if (!this.recording) throw new Error('not recording');
    this.recording = false;
    music.duck(false);
    const raw = concat(this.chunks);
    this.chunks = [];
    this.park();

    let samples = raw;
    if (this.sampleRate !== TARGET_RATE) {
      samples = await resampleHQ(samples, this.sampleRate, TARGET_RATE);
    }
    samples = trimSilence(samples);
    samples = normalizePeak(samples); // AGC is off — restore healthy level
    const wav = encodeWav(samples, TARGET_RATE);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    return { wav, durationSec: samples.length / TARGET_RATE, url };
  }

  cancel(): void {
    if (!this.recording) return;
    this.recording = false;
    music.duck(false);
    this.chunks = [];
    this.park();
  }

  /** Fully release the mic (drops the session permission grant on iOS). */
  release(): void {
    this.teardown();
  }

  private teardown(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.processor = null;
    this.source = null;
    this.highpass = null;
    this.chunks = [];
  }
}

/**
 * Shared app-wide recorder. Speak exercises must reuse this one instance —
 * constructing a fresh MicRecorder per exercise re-requests the mic, and iOS
 * standalone PWAs show a NEW permission prompt for every getUserMedia call.
 * The singleton holds the (muted) stream, so the session prompts only once.
 */
export const mic = new MicRecorder();

if (typeof window !== 'undefined') {
  // be a good citizen: let go of the mic when the app is really going away
  window.addEventListener('pagehide', () => mic.release());
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * High-quality resample via the browser's own audio engine (proper low-pass
 * filtering, no aliasing). Falls back to linear interpolation if unavailable.
 */
export async function resampleHQ(input: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to) return input;
  try {
    const frames = Math.ceil((input.length * to) / from);
    const off = new OfflineAudioContext(1, frames, to);
    const buf = off.createBuffer(1, input.length, from);
    buf.copyToChannel(input as Float32Array<ArrayBuffer>, 0);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } catch {
    return resample(input, from, to);
  }
}

/** Peak-normalize to a healthy level (gain capped so silence stays silence). */
export function normalizePeak(samples: Float32Array, target = 0.9, maxGain = 20): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 0.002) return samples; // effectively silence — don't amplify noise
  const gain = Math.min(target / peak, maxGain);
  if (gain <= 1.02) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/** Simple linear-interpolation resampler — fallback only. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Trim leading/trailing silence relative to the take's own peak. */
export function trimSilence(samples: Float32Array, threshold?: number, rate = TARGET_RATE): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const th = threshold ?? Math.max(0.006, peak * 0.04);
  let start = 0;
  let end = samples.length - 1;
  while (start < samples.length && Math.abs(samples[start]) < th) start++;
  while (end > start && Math.abs(samples[end]) < th) end--;
  const pad = Math.floor(0.15 * rate);
  start = Math.max(0, start - pad);
  end = Math.min(samples.length - 1, end + pad);
  return samples.slice(start, end + 1);
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buf;
}
