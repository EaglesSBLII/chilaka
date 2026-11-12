import { describe, expect, it } from 'vitest';
import {
  aksharaCount,
  isTraceable,
  centreStrokes,
  scoreTrace,
  type Pt,
  type TraceMask,
} from '../../src/engine/trace';

/** A 96x96 mask with a thick "L": vertical bar + horizontal foot. */
function maskL(): TraceMask {
  const w = 96;
  const h = 96;
  const data = new Uint8Array(w * h);
  for (let y = 16; y < 80; y++) for (let x = 24; x < 34; x++) data[y * w + x] = 1;
  for (let y = 70; y < 80; y++) for (let x = 24; x < 72; x++) data[y * w + x] = 1;
  return { w, h, data };
}
const line = (a: Pt, b: Pt, n = 40): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
// the centre line of the L, as a person would draw it
const centre = (): Pt[][] => [[...line({ x: 29, y: 17 }, { x: 29, y: 75 }), ...line({ x: 29, y: 75 }, { x: 71, y: 75 })]];

describe('akshara counting', () => {
  it('counts letters, vowel signs and conjuncts as one akshara each', () => {
    expect(aksharaCount('అ')).toBe(1);
    expect(aksharaCount('కా')).toBe(1);
    expect(aksharaCount('క్ష')).toBe(1);
    expect(aksharaCount('అం')).toBe(1);
    expect(aksharaCount('అమ్మ')).toBe(2);
    expect(aksharaCount('ఏనుగు')).toBe(3);
    expect(aksharaCount('నమస్కారం')).toBe(4);
  });
  it('traceable = up to three aksharas, one word', () => {
    expect(isTraceable('అ')).toBe(true);
    expect(isTraceable('ఇల్లు')).toBe(true);
    expect(isTraceable('ఏనుగు')).toBe(true);
    expect(isTraceable('నమస్కారం')).toBe(false);
    expect(isTraceable('మీ పేరు')).toBe(false);
    expect(isTraceable('')).toBe(false);
  });
});

describe('scoreTrace', () => {
  const mask = maskL();
  it('passes a clean centre-line trace', () => {
    const r = scoreTrace(mask, centre());
    expect(r.coverage).toBeGreaterThan(0.9);
    expect(r.accuracy).toBeGreaterThan(0.9);
    expect(r.pass).toBe(true);
  });
  it('passes a slightly wobbly trace', () => {
    const wobble = centre().map((s) => s.map((p, i) => ({ x: p.x + Math.sin(i) * 2.5, y: p.y + Math.cos(i * 1.3) * 2.5 })));
    expect(scoreTrace(mask, wobble).pass).toBe(true);
  });
  it('fails when only half the letter is traced', () => {
    const r = scoreTrace(mask, [line({ x: 29, y: 17 }, { x: 29, y: 75 })]);
    expect(r.accuracy).toBeGreaterThan(0.9);
    expect(r.coverage).toBeLessThan(0.75);
    expect(r.pass).toBe(false);
  });
  it('fails a scribble over the whole box even though it covers the letter', () => {
    const scribble: Pt[][] = [];
    for (let y = 4; y < 92; y += 6) scribble.push(line({ x: 4, y }, { x: 92, y }));
    const r = scoreTrace(mask, scribble);
    expect(r.coverage).toBeGreaterThan(0.8);
    expect(r.accuracy).toBeLessThan(0.5);
    expect(r.pass).toBe(false);
  });
  it('fails the right shape drawn in the wrong place', () => {
    const moved = centre().map((s) => s.map((p) => ({ x: p.x + 22, y: p.y - 14 })));
    expect(scoreTrace(mask, moved).pass).toBe(false);
  });
  it('no ink scores zero and never passes', () => {
    expect(scoreTrace(mask, [])).toEqual({ coverage: 0, accuracy: 0, pass: false });
    expect(scoreTrace(mask, [[{ x: 29, y: 20 }]]).pass).toBe(false);
  });
  it('going over a line twice is still fine', () => {
    const twice = [...centre(), ...centre().map((s) => [...s].reverse())];
    expect(scoreTrace(mask, twice).pass).toBe(true);
  });
  it('a small mark (like a sunna) passes with a small drawing', () => {
    const w = 96;
    const data = new Uint8Array(w * w);
    for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) data[y * w + x] = 1;
    const cross = [line({ x: 42, y: 42 }, { x: 54, y: 54 }, 8), line({ x: 54, y: 42 }, { x: 42, y: 54 }, 8)];
    expect(scoreTrace({ w, h: w, data }, cross).pass).toBe(true);
  });
});

describe('centreStrokes', () => {
  it('follows the middle of the letter and passes as a trace of it', () => {
    const mask = maskL();
    const strokes = centreStrokes(mask);
    const pts = strokes.flat();
    expect(pts.length).toBeGreaterThan(60);
    for (const p of pts) expect(mask.data[p.y * mask.w + p.x]).toBe(1);
    // one cell wide: far fewer cells than the letter itself
    expect(pts.length).toBeLessThan(mask.data.reduce((a, b) => a + b, 0) / 4);
    expect(scoreTrace(mask, strokes).pass).toBe(true);
  });
});
