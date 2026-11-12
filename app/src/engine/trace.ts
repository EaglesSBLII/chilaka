// Letter tracing: pure scoring. The letter is a small bitmap mask (rendered by
// the UI with the device's Telugu font); the learner's drawing is a list of
// strokes in the same grid coordinates. No stroke order is involved: a trace
// is right when the ink covers the letter and stays close to it.
//
// This judges a drawing made OVER the guide. It cannot tell one freehand
// letter from another (Telugu letters are too alike as blobs, and handwriting
// never matches a font), so writing from memory is self-checked in the UI.

export interface Pt {
  x: number;
  y: number;
}

/** 1 = letter, 0 = background; row-major, w*h cells. */
export interface TraceMask {
  w: number;
  h: number;
  data: Uint8Array;
}

export interface TraceScore {
  /** share of the letter that has ink near it, 0..1 */
  coverage: number;
  /** share of the ink that lies near the letter, 0..1 */
  accuracy: number;
  pass: boolean;
}

export interface TraceRules {
  /** how near ink must be to count a letter cell as covered (fraction of mask height) */
  coverRadius: number;
  /** how near the letter an ink point must be to count as on the letter */
  inkRadius: number;
  minCoverage: number;
  minAccuracy: number;
}

// The learner draws over a visible guide. Tuned against every letter of the
// course in a real browser font (tests/e2e/trace.spec.ts): a hand that wobbles
// stays a pass (also when a line is gone over twice); half a letter, or a
// scribble across the sheet, does not. Hatching densely inside the letter's own
// box does pass: Telugu letters are so full that it is the same ink as writing
// the letter twice, and nothing here can tell the two apart.
export const TRACE_RULES: TraceRules = { coverRadius: 0.06, inkRadius: 0.05, minCoverage: 0.8, minAccuracy: 0.7 };

// ---- Telugu aksharas ----

const VIRAMA = 0x0c4d;
const isConsonant = (c: number) => (c >= 0x0c15 && c <= 0x0c39) || (c >= 0x0c58 && c <= 0x0c5a);
const isIndependentVowel = (c: number) => (c >= 0x0c05 && c <= 0x0c14) || c === 0x0c60 || c === 0x0c61;

/**
 * Number of aksharas (written syllable blocks): a vowel letter, or a consonant
 * with everything attached to it (vowel sign, anusvara, conjunct consonants).
 * Done by hand because Intl.Segmenter disagrees between browsers on conjuncts.
 */
export function aksharaCount(te: string): number {
  let n = 0;
  let prev = 0;
  for (const ch of te.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (isIndependentVowel(c) || (isConsonant(c) && prev !== VIRAMA)) n++;
    prev = c;
  }
  return n;
}

/** Short enough to draw in one go: one word of at most three aksharas. */
export function isTraceable(te: string): boolean {
  const n = aksharaCount(te);
  return n >= 1 && n <= 3 && !/\s/.test(te.trim());
}

// ---- geometry ----

/** Points every `step` cells along the strokes (always includes each stroke's ends). */
export function resample(strokes: Pt[][], step = 1.5): Pt[] {
  const out: Pt[] = [];
  for (const s of strokes) {
    if (s.length === 0) continue;
    out.push(s[0]);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(d / step));
      for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  return out;
}

/** Distance (in cells) from every cell to the nearest set cell: two-pass 3-4 chamfer. */
export function distanceField(set: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = set[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

interface GlyphInfo {
  field: Float32Array; // distance to the letter
  count: number; // letter cells
}
const glyphFieldCache = new WeakMap<TraceMask, GlyphInfo>();
function glyphField(mask: TraceMask): GlyphInfo {
  let c = glyphFieldCache.get(mask);
  if (!c) {
    let count = 0;
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) count++;
    c = { field: distanceField(mask.data, mask.w, mask.h), count };
    glyphFieldCache.set(mask, c);
  }
  return c;
}

/** Compare a drawing (strokes in mask cells) with the letter it was drawn over. */
export function scoreTrace(mask: TraceMask, strokes: Pt[][], rules: TraceRules = TRACE_RULES): TraceScore {
  const { field, count } = glyphField(mask);
  const drawn = strokes.filter((s) => s.length > 0);
  if (count === 0 || drawn.length === 0) return { coverage: 0, accuracy: 0, pass: false };
  const pts = resample(drawn);
  const { w, h } = mask;
  const coverR = rules.coverRadius * h;
  const inkR = rules.inkRadius * h;

  const ink = new Uint8Array(w * h);
  let near = 0;
  for (const p of pts) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= w || y >= h) continue; // off the canvas: counts against accuracy
    ink[y * w + x] = 1;
    if (field[y * w + x] <= inkR) near++;
  }
  const inkField = distanceField(ink, w, h);
  let covered = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] && inkField[i] <= coverR) covered++;

  const coverage = covered / count;
  const accuracy = near / pts.length;
  return { coverage, accuracy, pass: coverage >= rules.minCoverage && accuracy >= rules.minAccuracy };
}

/** Zhang-Suen thinning: the one-cell-wide centre line of the letter. */
export function skeleton(mask: TraceMask): Uint8Array {
  const { w, h } = mask;
  const g = Uint8Array.from(mask.data);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : g[y * w + x]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      const kill: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!g[y * w + x]) continue;
          const p2 = at(x, y - 1);
          const p3 = at(x + 1, y - 1);
          const p4 = at(x + 1, y);
          const p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1);
          const p7 = at(x - 1, y + 1);
          const p8 = at(x - 1, y);
          const p9 = at(x - 1, y - 1);
          const n = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (n < 2 || n > 6) continue;
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let turns = 0;
          for (let k = 0; k < 8; k++) if (!ring[k] && ring[k + 1]) turns++;
          if (turns !== 1) continue;
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          kill.push(y * w + x);
        }
      }
      if (kill.length > 0) changed = true;
      for (const i of kill) g[i] = 0;
    }
  }
  return g;
}

/**
 * The letter's centre line as pen strokes: what a careful hand would draw
 * (in no particular order). Used as the known-good drawing by tests and by
 * the e2e pointer driver.
 */
export function centreStrokes(mask: TraceMask): Pt[][] {
  const { w, h } = mask;
  const sk = skeleton(mask);
  const left = new Set<number>();
  for (let i = 0; i < sk.length; i++) if (sk[i]) left.add(i);
  const out: Pt[][] = [];
  const next = (i: number): number => {
    const x = i % w;
    const y = (i - x) / w;
    // straight neighbours first, so lines come out straight
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (left.has(ny * w + nx)) return ny * w + nx;
    }
    return -1;
  };
  while (left.size > 0) {
    let i: number = left.values().next().value!;
    const stroke: Pt[] = [];
    while (i >= 0) {
      left.delete(i);
      stroke.push({ x: i % w, y: Math.floor(i / w) });
      i = next(i);
    }
    out.push(stroke);
  }
  return out;
}
