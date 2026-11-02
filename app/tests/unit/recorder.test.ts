import { describe, expect, it } from 'vitest';
import { measureTake, normalizeLoudness, trimSilence } from '../../src/platform/recorder';

const RATE = 16000;

/** noise floor + a burst of "voice" (a 220 Hz tone) between from..to seconds */
function take(seconds: number, from: number, to: number, amp = 0.3, noise = 0.002): Float32Array {
  const s = new Float32Array(Math.floor(seconds * RATE));
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < s.length; i++) {
    const t = i / RATE;
    s[i] = rnd() * noise + (t >= from && t < to ? amp * Math.sin(2 * Math.PI * 220 * t) : 0);
  }
  return s;
}

describe('trimSilence', () => {
  it('cuts room noise around the phrase but keeps a runway each side', () => {
    const s = take(3, 1.0, 2.0);
    const out = trimSilence(s);
    const secs = out.length / RATE;
    expect(secs).toBeGreaterThan(1.3); // 1 s voice + 0.2 s pad each side
    expect(secs).toBeLessThan(1.5);
  });

  it('keeps a soft onset — a quiet start is not treated as silence', () => {
    const s = take(3, 1.0, 2.0);
    // fade the first 150 ms of the voice down to 5% so the opening is breathy
    for (let i = 0; i < 0.15 * RATE; i++) s[RATE + i] *= 0.05 + (0.95 * i) / (0.15 * RATE);
    const out = trimSilence(s);
    // the onset (at 1.0 s) must still be inside the kept region, i.e. we kept ≥ ~1.35 s
    expect(out.length / RATE).toBeGreaterThan(1.3);
  });

  it('leaves a take with no voice untouched instead of trimming it to nothing', () => {
    const s = take(1, 5, 6); // no voice inside the take
    expect(trimSilence(s).length).toBe(s.length);
  });
});

describe('normalizeLoudness', () => {
  it('brings a quiet take up to the target loudness without clipping', () => {
    const quiet = take(2, 0.5, 1.5, 0.02);
    const out = normalizeLoudness(quiet);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(0.95);
  });

  it('does not amplify silence into hiss', () => {
    const silence = take(1, 5, 6, 0, 0.001);
    expect(normalizeLoudness(silence)).toBe(silence);
  });

  it('turns a hot take down so peaks sit under the rail', () => {
    const hot = take(2, 0.5, 1.5, 0.99);
    const out = normalizeLoudness(hot);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.95);
  });
});

describe('measureTake', () => {
  it('flags silence, quiet and clipping', () => {
    expect(measureTake(take(1, 5, 6, 0, 0.001)).silent).toBe(true);
    expect(measureTake(take(2, 0.5, 1.5, 0.012)).quiet).toBe(true);
    const ok = measureTake(take(2, 0.5, 1.5, 0.3));
    expect(ok.silent).toBe(false);
    expect(ok.quiet).toBe(false);
    expect(ok.clipped).toBe(0);
    const hot = take(2, 0.5, 1.5, 1.4);
    expect(measureTake(hot).clipped).toBeGreaterThan(0.005);
  });
});
