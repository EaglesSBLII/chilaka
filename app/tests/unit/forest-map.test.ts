import { describe, expect, it } from 'vitest';
import {
  bridgePath,
  decorSlots,
  flightPlan,
  metrics,
  NODE_R,
  perchPoint,
  PITCH,
  stubPath,
  unitLayout,
  type Side,
} from '../../src/features/forest/layout';
import { findCurrent, flightOrigin, lessonStates, nextStartSide, type NodeState } from '../../src/features/forest/model';

describe('forest layout: metrics', () => {
  it('clamps the column width', () => {
    expect(metrics(200).width).toBe(320);
    expect(metrics(390).width).toBe(390);
    expect(metrics(1400).width).toBe(560);
  });
  it('keeps perches clear of both trunks and of each other at every width', () => {
    for (const w of [320, 360, 390, 430, 500, 560]) {
      const m = metrics(w);
      expect(m.xLeft - NODE_R).toBeGreaterThanOrEqual(m.trunk + 4);
      expect(m.xRight + NODE_R).toBeLessThanOrEqual(m.width - m.trunk - 4);
      expect(m.xRight - m.xLeft).toBeGreaterThanOrEqual(2 * NODE_R + 60);
      // mirror symmetric
      expect(m.xLeft + m.xRight).toBe(m.width);
    }
  });
});

describe('forest layout: one unit', () => {
  const m = metrics(390);
  it('alternates sides from the given start side, one row per node', () => {
    const l = unitLayout(5, 'R', m);
    expect(l.nodes.map((n) => n.side)).toEqual(['R', 'L', 'R', 'L', 'R']);
    expect(l.nodes.map((n) => n.x)).toEqual([m.xRight, m.xLeft, m.xRight, m.xLeft, m.xRight]);
    for (let i = 1; i < l.nodes.length; i++) expect(l.nodes[i].y - l.nodes[i - 1].y).toBe(PITCH);
  });
  it('leaves room above the first perch for the bird and below the last for the START tag', () => {
    const l = unitLayout(3, 'L', m);
    expect(l.nodes[0].y - NODE_R).toBeGreaterThanOrEqual(44);
    expect(l.height - (l.nodes[2].y + NODE_R)).toBeGreaterThanOrEqual(36);
    expect(l.height).toBe(l.nodes[0].y + 2 * PITCH + (l.height - l.nodes[2].y));
  });
  it('enters and leaves through the middle of the column', () => {
    const l = unitLayout(4, 'L', m);
    expect(l.entry).toEqual({ x: m.width / 2, y: 0 });
    expect(l.exit).toEqual({ x: m.width / 2, y: l.height });
  });
  it('handles a single node', () => {
    const l = unitLayout(1, 'L', m);
    expect(l.nodes).toHaveLength(1);
    expect(l.height).toBeGreaterThan(2 * NODE_R);
  });
});

function endpoints(d: string): [number, number, number, number] {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return [nums[0], nums[1], nums[nums.length - 2], nums[nums.length - 1]];
}

describe('forest layout: route curves', () => {
  const m = metrics(390);
  const l = unitLayout(4, 'L', m);
  it('bridges run from deck to deck and sag below the straight line', () => {
    const [a, b] = l.nodes;
    const d = bridgePath(a, b);
    const [x0, y0, x1, y1] = endpoints(d);
    expect(x0).toBe(a.x);
    expect(x1).toBe(b.x);
    expect(y0).toBeGreaterThan(a.y); // deck level is below the token centre
    expect(y1 - y0).toBe(b.y - a.y);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const cy = nums[3];
    expect(cy).toBeGreaterThan((y0 + y1) / 2); // control point pulled down = sag
  });
  it('stubs join the column centre to the first and last perch', () => {
    const inD = endpoints(stubPath(l.entry, l.nodes[0]));
    expect(inD[0]).toBe(m.width / 2);
    expect(inD[1]).toBe(0);
    expect(inD[2]).toBe(l.nodes[0].x);
    const outD = endpoints(stubPath(l.nodes[3], l.exit));
    expect(outD[2]).toBe(m.width / 2);
    expect(outD[3]).toBe(l.height);
  });
});

describe('forest layout: decoration slots', () => {
  it('puts exactly one slot per row, on the side opposite the perch, away from it', () => {
    for (const w of [320, 390, 560]) {
      const m = metrics(w);
      const l = unitLayout(6, 'L', m);
      const slots = decorSlots(l, m, 'u01');
      expect(slots).toHaveLength(6);
      slots.forEach((s, i) => {
        const n = l.nodes[i];
        expect(s.side).not.toBe(n.side);
        expect(s.y).toBe(n.y);
        expect(Math.abs(s.x - n.x)).toBeGreaterThanOrEqual(2 * NODE_R + 40);
      });
    }
  });
  it('is deterministic per unit and varies between units', () => {
    const m = metrics(390);
    const l = unitLayout(6, 'L', m);
    expect(decorSlots(l, m, 'u07')).toEqual(decorSlots(l, m, 'u07'));
    const kinds = new Set(['u01', 'u02', 'u03', 'u04', 'u05'].map((id) => decorSlots(l, m, id).map((s) => s.kind).join(',')));
    expect(kinds.size).toBeGreaterThan(1);
  });
  it('never repeats the same decoration on consecutive rows', () => {
    const m = metrics(390);
    const l = unitLayout(6, 'R', m);
    for (const id of ['u01', 'u13', 's02', 'u44']) {
      const s = decorSlots(l, m, id);
      for (let i = 1; i < s.length; i++) expect(s[i].kind).not.toBe(s[i - 1].kind);
    }
  });
});

describe('forest layout: flight', () => {
  it('starts and ends exactly on the perch points', () => {
    const from = { x: 109, y: 200 };
    const to = { x: 281, y: 300 };
    const f = flightPlan(from, to, 16);
    expect(f.xs[0]).toBe(from.x);
    expect(f.ys[0]).toBe(from.y);
    expect(f.xs[f.xs.length - 1]).toBe(to.x);
    expect(f.ys[f.ys.length - 1]).toBe(to.y);
    expect(f.xs).toHaveLength(17);
  });
  it('arcs above both ends', () => {
    const f = flightPlan({ x: 109, y: 200 }, { x: 281, y: 300 }, 24);
    expect(Math.min(...f.ys)).toBeLessThan(200 - 12);
  });
  it('faces the direction of travel and moves monotonically across', () => {
    const right = flightPlan({ x: 100, y: 0 }, { x: 300, y: 100 });
    expect(right.facing).toBe(1);
    for (let i = 1; i < right.xs.length; i++) expect(right.xs[i]).toBeGreaterThanOrEqual(right.xs[i - 1]);
    const left = flightPlan({ x: 300, y: 0 }, { x: 100, y: 100 });
    expect(left.facing).toBe(-1);
  });
  it('lasts between 0.7 and 1.6 seconds, longer for longer hops', () => {
    const short = flightPlan({ x: 0, y: 0 }, { x: 40, y: 0 });
    const mid = flightPlan({ x: 109, y: 0 }, { x: 281, y: 100 });
    const long = flightPlan({ x: 0, y: 0 }, { x: 0, y: 800 });
    expect(short.duration).toBe(0.7);
    expect(long.duration).toBe(1.6);
    expect(mid.duration).toBeGreaterThan(short.duration);
    expect(mid.duration).toBeLessThan(long.duration);
  });
  it('perch point sits on top of the token', () => {
    expect(perchPoint({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 - NODE_R });
  });
});

describe('forest model: lesson states (same rules as the classic path)', () => {
  const unit = { id: 'u1', section: 2, lessons: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  it('locked units lock every lesson', () => {
    expect(lessonStates(unit, 'locked', [], 0)).toEqual(['locked', 'locked', 'locked']);
  });
  it('first incomplete lesson is current, later ones locked, finished ones done', () => {
    expect(lessonStates(unit, 'active', ['a'], 0)).toEqual(['done', 'current', 'locked']);
    expect(lessonStates(unit, 'active', [], 0)).toEqual(['current', 'locked', 'locked']);
    expect(lessonStates(unit, 'done', ['a', 'b', 'c'], 0)).toEqual(['done', 'done', 'done']);
  });
  it('units before a placed-ahead start are open for review, never current', () => {
    expect(lessonStates(unit, 'active', ['b'], 4)).toEqual(['replayable', 'done', 'replayable']);
  });
});

describe('forest model: current perch and flight', () => {
  const units = [
    { id: 'u1', lessons: [{ id: 'a' }, { id: 'b' }] },
    { id: 'u2', lessons: [{ id: 'c' }] },
  ];
  const st = (...rows: NodeState[][]) => new Map(units.map((u, i) => [u.id, rows[i]]));
  it('finds the single current lesson', () => {
    expect(findCurrent(units, st(['done', 'current'], ['locked']))).toEqual({ unitId: 'u1', lessonId: 'b' });
    expect(findCurrent(units, st(['done', 'done'], ['current']))).toEqual({ unitId: 'u2', lessonId: 'c' });
    expect(findCurrent(units, st(['done', 'done'], ['done']))).toBeNull();
  });
  it('flies only when the remembered perch was completed and the current one moved', () => {
    const a = { unitId: 'u1', lessonId: 'a' };
    const b = { unitId: 'u1', lessonId: 'b' };
    const done = (r: { lessonId: string }) => r.lessonId === 'a';
    expect(flightOrigin(a, b, done)).toEqual(a);
    expect(flightOrigin(null, b, done)).toBeNull(); // first load
    expect(flightOrigin(b, b, done)).toBeNull(); // nothing changed
    expect(flightOrigin(b, a, done)).toBeNull(); // remembered one is not done (e.g. data replaced by sync)
    expect(flightOrigin(a, null, done)).toBeNull(); // course finished
  });
  it('carries the left/right alternation across units', () => {
    const flip = (s: Side, n: number) => nextStartSide(s, n);
    expect(flip('L', 5)).toBe('R');
    expect(flip('L', 6)).toBe('L');
    expect(flip('R', 3)).toBe('L');
  });
});
