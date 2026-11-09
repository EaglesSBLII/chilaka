// Acoustic matching: does this take sound like the native clip of the same
// phrase? Mel-frequency cepstra (speaker-normalised) compared by dynamic time
// warping, so a slower or faster learner still lines up with the reference.
//
// Why it exists: the phone's recogniser (Workers AI Whisper) hallucinates on
// one-second clips — it cannot even transcribe OUR native recordings of the
// first lessons' single words — while the Mac's whisper medium can. For short
// phrases the web grades by ear instead, against the clip the learner just
// heard; for longer phrases it is the fallback when the transcript is nonsense.
// Pure functions over 16 kHz mono PCM; no DOM.

export const ACOUSTIC_RATE = 16000;
const FRAME = 400; // 25 ms
const HOP = 160; // 10 ms
const NFFT = 512;
const N_MEL = 26;
const N_CEPS = 13;
const PRE_EMPHASIS = 0.97;

// ---- tiny FFT (radix-2, in place) ----
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const hz2mel = (f: number) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m: number) => 700 * (10 ** (m / 2595) - 1);

let melBank: Float64Array[] | null = null;
function melFilters(): Float64Array[] {
  if (melBank) return melBank;
  const lo = hz2mel(80);
  const hi = hz2mel(7600);
  const pts = Array.from({ length: N_MEL + 2 }, (_, i) => mel2hz(lo + ((hi - lo) * i) / (N_MEL + 1)));
  const bins = pts.map((f) => Math.floor(((NFFT + 1) * f) / ACOUSTIC_RATE));
  melBank = Array.from({ length: N_MEL }, (_, m) => {
    const w = new Float64Array(NFFT / 2 + 1);
    for (let k = bins[m]; k < bins[m + 1]; k++) w[k] = (k - bins[m]) / Math.max(1, bins[m + 1] - bins[m]);
    for (let k = bins[m + 1]; k < bins[m + 2]; k++) w[k] = (bins[m + 2] - k) / Math.max(1, bins[m + 2] - bins[m + 1]);
    return w;
  });
  return melBank;
}

const hamming = Float64Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/** Trim leading/trailing room noise (20 ms RMS windows against the take's own floor). */
export function trimForMatch(samples: Float32Array): Float32Array {
  const win = Math.floor(0.02 * ACOUSTIC_RATE);
  const n = Math.floor(samples.length / win);
  if (n < 3) return samples;
  const env = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let acc = 0;
    for (let i = w * win; i < (w + 1) * win; i++) acc += samples[i] * samples[i];
    env[w] = Math.sqrt(acc / win);
  }
  const sorted = Float64Array.from(env).sort();
  const floor = sorted[Math.floor(n * 0.1)];
  const peak = sorted[n - 1];
  if (peak < 0.004) return samples;
  const th = Math.max(0.003, floor * 3, peak * 0.08);
  let first = 0;
  while (first < n && env[first] < th) first++;
  let last = n - 1;
  while (last > first && env[last] < th) last--;
  const pad = Math.floor(0.06 * ACOUSTIC_RATE);
  return samples.slice(Math.max(0, first * win - pad), Math.min(samples.length, (last + 1) * win + pad));
}

/**
 * MFCC frames (13 coefficients, c0 = log energy) with per-utterance mean
 * subtraction so a different speaker or microphone colour mostly cancels.
 */
export interface FeatureOpts {
  /** 'ceps' = MFCC, 'mel' = log mel-filterbank energies */
  kind: 'ceps' | 'mel';
  /** divide by per-utterance standard deviation as well as subtracting the mean */
  variance: boolean;
  deltas: boolean;
}
export const DEFAULT_FEATURES: FeatureOpts = { kind: 'ceps', variance: false, deltas: true }; // the sweep winner: 97% top-1 across voices

export function mfcc(samples: Float32Array, opts: FeatureOpts = DEFAULT_FEATURES): Float32Array[] {
  const x = trimForMatch(samples);
  if (x.length < FRAME) return [];
  const filters = melFilters();
  const frames: Float32Array[] = [];
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const nFrames = 1 + Math.floor((x.length - FRAME) / HOP);
  const logMel = new Float64Array(N_MEL);
  for (let f = 0; f < nFrames; f++) {
    re.fill(0);
    im.fill(0);
    const off = f * HOP;
    let prev = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = x[off + i];
      re[i] = (s - PRE_EMPHASIS * prev) * hamming[i];
      prev = s;
    }
    fft(re, im);
    for (let m = 0; m < N_MEL; m++) {
      let e = 0;
      const w = filters[m];
      for (let k = 0; k <= NFFT / 2; k++) if (w[k]) e += w[k] * (re[k] * re[k] + im[k] * im[k]);
      logMel[m] = Math.log(e + 1e-8);
    }
    if (opts.kind === 'mel') {
      frames.push(Float32Array.from(logMel));
      continue;
    }
    const c = new Float32Array(N_CEPS);
    for (let i = 0; i < N_CEPS; i++) {
      let acc = 0;
      for (let m = 0; m < N_MEL; m++) acc += logMel[m] * Math.cos((Math.PI * i * (m + 0.5)) / N_MEL);
      c[i] = acc;
    }
    frames.push(c);
  }
  // per-utterance mean (and optionally variance) normalisation so speaker,
  // microphone and level mostly cancel; cepstral c0 (loudness) is dropped;
  // optional first-order deltas so the warping follows how sounds change
  const dim = frames[0].length;
  const first = opts.kind === 'ceps' ? 1 : 0;
  const mean = new Float64Array(dim);
  const sd = new Float64Array(dim).fill(1);
  for (const fr of frames) for (let i = 0; i < dim; i++) mean[i] += fr[i] / frames.length;
  if (opts.variance) {
    sd.fill(0);
    for (const fr of frames) for (let i = 0; i < dim; i++) sd[i] += (fr[i] - mean[i]) ** 2 / frames.length;
    for (let i = 0; i < dim; i++) sd[i] = Math.sqrt(sd[i]) || 1;
  }
  const norm = frames.map((fr) => {
    const o = new Float32Array(dim - first);
    for (let i = first; i < dim; i++) o[i - first] = (fr[i] - mean[i]) / sd[i];
    return o;
  });
  if (!opts.deltas) return norm;
  const d = dim - first;
  const out: Float32Array[] = [];
  for (let t = 0; t < norm.length; t++) {
    const prev = norm[Math.max(0, t - 2)];
    const next = norm[Math.min(norm.length - 1, t + 2)];
    const o = new Float32Array(d * 2);
    for (let i = 0; i < d; i++) {
      o[i] = norm[t][i];
      o[d + i] = (next[i] - prev[i]) / 2;
    }
    out.push(o);
  }
  return out;
}

/**
 * Dynamic-time-warping distance between two cepstral sequences, Euclidean per
 * frame, path-length normalised, Sakoe-Chiba band so a take cannot "match" by
 * stretching one syllable over the whole reference.
 */
export function dtw(a: Float32Array[], b: Float32Array[], band = 0.35, metric: 'euclid' | 'cosine' = 'euclid'): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return Infinity;
  const r = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * band));
  const INF = Number.POSITIVE_INFINITY;
  let prev = new Float64Array(m + 1).fill(INF);
  let prevSteps = new Float64Array(m + 1);
  let cur = new Float64Array(m + 1);
  let curSteps = new Float64Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(INF);
    const jLo = Math.max(1, i - r);
    const jHi = Math.min(m, i + r);
    for (let j = jLo; j <= jHi; j++) {
      const fa = a[i - 1];
      const fb = b[j - 1];
      let d = 0;
      if (metric === 'cosine') {
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let k = 0; k < fa.length; k++) {
          dot += fa[k] * fb[k];
          na += fa[k] * fa[k];
          nb += fb[k] * fb[k];
        }
        d = 1 - dot / (Math.sqrt(na * nb) || 1);
      } else {
        for (let k = 0; k < fa.length; k++) {
          const diff = fa[k] - fb[k];
          d += diff * diff;
        }
        d = Math.sqrt(d);
      }
      let best = prev[j - 1];
      let steps = prevSteps[j - 1];
      if (prev[j] < best) {
        best = prev[j];
        steps = prevSteps[j];
      }
      if (cur[j - 1] < best) {
        best = cur[j - 1];
        steps = curSteps[j - 1];
      }
      if (best === INF) continue;
      cur[j] = best + d;
      curSteps[j] = steps + 1;
    }
    [prev, cur] = [cur, prev];
    [prevSteps, curSteps] = [curSteps, prevSteps];
  }
  return prev[m] === INF ? INF : prev[m] / Math.max(1, prevSteps[m]);
}

/**
 * Calibrated on the native clips of the first four units, each voice's take
 * against the other voice's clips of every phrase in the unit (96 takes):
 * the right phrase ranks first 97% of the time with a median margin of 14%
 * (see tests/unit/acoustic.test.ts with CHILAKA_WAV set). A take passes when
 * its own phrase is the nearest and not absurdly far; "close" when it is the
 * runner-up by a hair.
 */
export const EAR_MARGIN_CLOSE = 0.04;
/** absolute ceiling: unrelated phrases sit around this distance or above */
export const EAR_MAX_DISTANCE = 36;

export interface EarVerdict {
  pass: boolean;
  close: boolean;
  /** 0 = the phrase itself was the nearest reference */
  rank: number;
  /** (nearest other − own) / own; positive when the phrase wins */
  margin: number;
  distance: number;
  lengthMismatch: boolean;
}

export interface EarReference {
  id: string;
  features: Float32Array[];
}

/**
 * Grade a take by ear: compare it with the native clip of its phrase AND with
 * the clips of the other phrases around it. Saying the right word puts its own
 * clip nearest; mumbling, silence or another word does not.
 */
export function gradeByEar(takeFeatures: Float32Array[], targetId: string, refs: readonly EarReference[]): EarVerdict {
  const target = refs.find((r) => r.id === targetId);
  if (!target || takeFeatures.length === 0 || target.features.length === 0) {
    return { pass: false, close: false, rank: -1, margin: 0, distance: Infinity, lengthMismatch: true };
  }
  const n = takeFeatures.length;
  const m = target.features.length;
  const lengthMismatch = n < m / 3 || n > m * 3;
  const scored = refs
    .filter((r) => r.features.length > 0)
    .map((r) => ({ id: r.id, d: dtw(takeFeatures, r.features) }))
    .sort((a, b) => a.d - b.d);
  const own = scored.find((r) => r.id === targetId)!.d;
  const rank = scored.findIndex((r) => r.id === targetId);
  const bestOther = scored.find((r) => r.id !== targetId)?.d ?? Infinity;
  const margin = Number.isFinite(bestOther) ? (bestOther - own) / own : 1;
  const sane = Number.isFinite(own) && own <= EAR_MAX_DISTANCE && !lengthMismatch;
  return {
    pass: sane && rank === 0,
    close: sane && (rank === 0 || (rank === 1 && margin >= -EAR_MARGIN_CLOSE)),
    rank,
    margin,
    distance: own,
    lengthMismatch,
  };
}

/** Parse a 16-bit PCM WAV (any chunk layout) into float samples; returns null if not mono 16-bit. */
export function wavToFloat32(wav: ArrayBuffer): { samples: Float32Array; sampleRate: number } | null {
  const v = new DataView(wav);
  if (v.byteLength < 12 || v.getUint32(0, false) !== 0x52494646) return null; // 'RIFF'
  let off = 12;
  let sampleRate = ACOUSTIC_RATE;
  let channels = 1;
  let bits = 16;
  while (off + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(off + 10, true);
      sampleRate = v.getUint32(off + 12, true);
      bits = v.getUint16(off + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) return null;
      const n = Math.floor(size / 2 / channels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = v.getInt16(off + 8 + i * 2 * channels, true) / 32768;
      return { samples: out, sampleRate };
    }
    off += 8 + size + (size & 1);
  }
  return null;
}
