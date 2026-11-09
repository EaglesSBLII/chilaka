import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dtw, EAR_MAX_DISTANCE, gradeByEar, mfcc, wavToFloat32 } from '../../src/engine/speech/acoustic';

function tone(freq: number, seconds: number, rate = 16000): Float32Array {
  const out = new Float32Array(Math.floor(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / rate) * Math.sin((Math.PI * i) / out.length);
  return out;
}
/** a crude "syllable" sequence: formant-ish tones in a row */
function word(freqs: number[], perSec = 0.18): Float32Array {
  const parts = freqs.map((f) => tone(f, perSec));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('acoustic matching', () => {
  it('a take matches itself and a time-stretched self better than a different word', () => {
    const a = word([300, 900, 500]);
    const slow = word([300, 900, 500], 0.26);
    const other = word([1200, 400, 1500]);
    expect(dtw(mfcc(a), mfcc(a))).toBeLessThan(1e-6);
    const dSlow = dtw(mfcc(a), mfcc(slow));
    const dOther = dtw(mfcc(a), mfcc(other));
    expect(dSlow).toBeLessThan(dOther);
  });

  it('grades by ear: the spoken word must be the nearest of the lesson phrases', () => {
    const refs = [
      { id: 'a', features: mfcc(word([300, 900, 500])) },
      { id: 'b', features: mfcc(word([1200, 400, 1500])) },
      { id: 'c', features: mfcc(word([700, 700, 200, 900])) },
    ];
    const good = gradeByEar(mfcc(word([300, 900, 500], 0.24)), 'a', refs);
    expect(good.rank).toBe(0);
    expect(good.pass).toBe(true);
    const wrong = gradeByEar(mfcc(word([1200, 400, 1500], 0.2)), 'a', refs);
    expect(wrong.pass).toBe(false);
    const tooShort = gradeByEar(mfcc(tone(400, 0.1)), 'c', refs);
    expect(tooShort.lengthMismatch).toBe(true);
    expect(tooShort.pass).toBe(false);
    expect(gradeByEar([], 'a', refs).pass).toBe(false);
  });

  it('parses WAVs with extra chunks before the data', () => {
    const samples = new Int16Array([0, 16384, -16384, 32767]);
    const extra = 6;
    const buf = new ArrayBuffer(12 + 24 + 8 + extra + 8 + samples.byteLength);
    const v = new DataView(buf);
    const put = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    put(0, 'RIFF');
    v.setUint32(4, buf.byteLength - 8, true);
    put(8, 'WAVE');
    put(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true);
    v.setUint16(34, 16, true);
    put(36, 'FLLR');
    v.setUint32(40, extra, true);
    put(44 + extra, 'data');
    v.setUint32(48 + extra, samples.byteLength, true);
    new Int16Array(buf, 52 + extra).set(samples);
    const parsed = wavToFloat32(buf)!;
    expect(parsed.sampleRate).toBe(16000);
    expect([...parsed.samples].map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 1]);
  });
});

// ---- calibration against the real clips (CHILAKA_WAV=<dir of <voice>-<itemId>.wav>) ----
// Positives: the SAME phrase in our two voices (different speakers, same
// words). Negatives: different phrases. Prints the separation and checks the
// shipped thresholds sit between the two populations.
const WAV_DIR = process.env.CHILAKA_WAV;
describe.skipIf(!WAV_DIR || !existsSync(WAV_DIR))('calibration on native clips', () => {
  it('the shipped configuration ranks the right phrase first across voices', () => {
    const files = readdirSync(WAV_DIR!).filter((f) => f.endsWith('.wav'));
    const feats = new Map<string, Float32Array[]>();
    for (const f of files) {
      const parsed = wavToFloat32(readFileSync(join(WAV_DIR!, f)).buffer.slice(0) as ArrayBuffer);
      if (parsed) feats.set(f.replace('.wav', ''), mfcc(parsed.samples));
    }
    const ids = [...new Set([...feats.keys()].map((k) => k.replace(/^(female|male)-/, '')))].filter((id) => feats.has(`female-${id}`) && feats.has(`male-${id}`));
    const unitOf = (id: string) => id.split('-')[0];
    const q = (arr: number[], p: number) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    let pass = 0;
    let close = 0;
    let total = 0;
    let wrongPass = 0;
    let wrongTotal = 0;
    const own: number[] = [];
    const other: number[] = [];
    const margins: number[] = [];
    for (const [take, ref] of [['female', 'male'], ['male', 'female']] as const) {
      for (const id of ids) {
        const refs = ids.filter((o) => unitOf(o) === unitOf(id)).map((o) => ({ id: o, features: feats.get(`${ref}-${o}`)! }));
        const v = gradeByEar(feats.get(`${take}-${id}`)!, id, refs);
        total++;
        if (v.pass) pass++;
        if (v.close) close++;
        own.push(v.distance);
        margins.push(v.margin);
        // the same take graded as if the learner had been asked for a DIFFERENT phrase must fail
        for (const o of refs.map((r) => r.id).filter((o) => o !== id).slice(0, 3)) {
          wrongTotal++;
          const w = gradeByEar(feats.get(`${take}-${id}`)!, o, refs);
          other.push(w.distance);
          if (w.pass) wrongPass++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `takes=${total} pass=${((pass / total) * 100).toFixed(0)}% close=${((close / total) * 100).toFixed(0)}% wrong-phrase pass=${((wrongPass / wrongTotal) * 100).toFixed(1)}% ` +
        `margin p10/p25/p50=${q(margins, 0.1).toFixed(2)}/${q(margins, 0.25).toFixed(2)}/${q(margins, 0.5).toFixed(2)} own p50/p90/max=${q(own, 0.5).toFixed(1)}/${q(own, 0.9).toFixed(1)}/${Math.max(...own).toFixed(1)} other p10/p50=${q(other, 0.1).toFixed(1)}/${q(other, 0.5).toFixed(1)} ceiling=${EAR_MAX_DISTANCE}`,
    );
    expect(pass / total).toBeGreaterThan(0.9);
    expect(wrongPass / wrongTotal).toBeLessThan(0.05);
  });
});
