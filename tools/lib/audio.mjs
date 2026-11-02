// Shared audio post-production helpers (used by polish-audio.mjs and render-dialogue.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

export const FFMPEG = process.env.FFMPEG || execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
export const LEAD_S = 0.26; // silence before the first syllable
export const TAIL_S = 0.4; // room after the last syllable
export const TARGET_LUFS = -15; // integrated loudness every clip is matched to
export const TRUE_PEAK_DB = -1.5; // ceiling so the hottest clips never clip
export const SR = 24000;


// ---- WAV helpers (16-bit mono) ----
export function readWav(path) {
  const buf = readFileSync(path);
  let o = 12, dataOff = 44, dataLen = buf.length - 44, sr = SR;
  while (o < buf.length - 8) {
    const id = buf.toString('ascii', o, o + 4);
    const sz = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(o + 12);
    if (id === 'data') { dataOff = o + 8; dataLen = sz; break; }
    o += 8 + sz;
  }
  const n = Math.floor(dataLen / 2);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  return { samples: s, sampleRate: sr };
}
export function writeWav(path, samples, sr) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(v < 0 ? v * 0x8000 : v * 0x7fff, 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/** Cut whatever lead/tail silence the take already has (keeping a soft onset), then
 *  rebuild the edges: fixed lead-in, fixed tail, short fades so nothing clicks. */
export function reshape(samples, sr, { lead = LEAD_S, tail = TAIL_S } = {}) {
  const n = samples.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const th = Math.max(0.01, peak * 0.03);
  let start = 0;
  while (start < n && Math.abs(samples[start]) < th) start++;
  let end = n - 1;
  while (end > start && Math.abs(samples[end]) < th) end--;
  if (start >= end) return samples;
  start = Math.max(0, start - Math.floor(sr * 0.03)); // keep breathy onsets (h-, s-, v-)
  end = Math.min(n - 1, end + Math.floor(sr * 0.08));
  const voice = samples.slice(start, end + 1);
  const fi = Math.floor(sr * 0.012), fo = Math.floor(sr * 0.06);
  for (let i = 0; i < fi && i < voice.length; i++) voice[i] *= i / fi;
  for (let i = 0; i < fo && i < voice.length; i++) voice[voice.length - 1 - i] *= i / fo;
  const out = new Float32Array(Math.floor(sr * lead) + voice.length + Math.floor(sr * tail));
  out.set(voice, Math.floor(sr * lead));
  return out;
}

/** Integrated loudness (LUFS) + true peak (dBTP) via ffmpeg's EBU R128 meter. */
export function measure(wavPath) {
  // the meter prints its summary on stderr
  const out = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', wavPath, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const summary = out.slice(out.lastIndexOf('Summary:'));
  const I = Number(/I:\s*(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1]);
  return { I, peak: Number.isFinite(peak) ? peak : -120 };
}

/** Gain (dB) that lands the clip on TARGET_LUFS. A peaky take may overshoot the
 *  ceiling by up to LIMIT_DB — the limiter absorbs that transparently; anything
 *  beyond it is given up on so the voice is never squashed. */
export const LIMIT_DB = 8;
export function matchGainDb({ I, peak }, target = TARGET_LUFS, ceiling = TRUE_PEAK_DB) {
  if (!Number.isFinite(I) || I < -60) return 0;
  const wantDb = target - I;
  const roomDb = ceiling - peak;
  return Math.min(wantDb, roomDb + LIMIT_DB);
}


/** Reshape + loudness-match one WAV file into another (the whole polish pass for a clip). */
export function polishWav(inPath, outPath, tmpDir) {
  const raw = `${tmpDir}/raw.wav`;
  const shaped = `${tmpDir}/shaped.wav`;
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', inPath, '-ac', '1', '-ar', String(SR), '-sample_fmt', 's16', raw]);
  const { samples, sampleRate } = readWav(raw);
  const out = reshape(samples, sampleRate);
  writeWav(shaped, out, sampleRate);
  const before = measure(shaped);
  const gainDb = matchGainDb(before);
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', shaped, '-af',
    `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${Math.pow(10, TRUE_PEAK_DB / 20).toFixed(3)}:attack=3:release=40:level=false`,
    '-ac', '1', '-ar', String(SR), '-sample_fmt', 's16', outPath]);
  return { before: before.I, after: measure(outPath).I, secs: out.length / sampleRate };
}

/** Max-quality AAC, the same settings the render gate uses. */
export function encodeM4a(wavPath, m4aPath) {
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-q', '127', '-s', '0', wavPath, m4aPath], { stdio: 'pipe' });
}
