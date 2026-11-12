// Forest map geometry. Pure functions only (no React, no DOM) so the layout
// can be unit tested: see tests/unit/forest-map.test.ts.
//
// Coordinates are CSS pixels inside one unit's "map area": x from the left edge
// of the forest column, y from the top of that unit's area.

import { hashString, mulberry32 } from '../../engine/rng';

export type Side = 'L' | 'R';

export interface Pt {
  x: number;
  y: number;
}

export interface Metrics {
  /** column width in px (clamped) */
  width: number;
  /** how much of each great trunk shows at the column edge */
  trunk: number;
  /** x of perches on the left tree / right tree */
  xLeft: number;
  xRight: number;
}

/** radius of a lesson token */
export const NODE_R = 32;
/** vertical distance between consecutive perches */
export const PITCH = 100;
/** the deck (and so the bridge) sits this far below the token centre */
export const DECK_DY = 24;
/** first perch centre from the top of a unit's area (room for the bird) */
const TOP = 86;
/** last perch centre to the bottom of the area (room for deck and START tag) */
const BOTTOM = 80;

export const MIN_WIDTH = 320;
export const MAX_WIDTH = 560;

export function metrics(rawWidth: number): Metrics {
  const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rawWidth)));
  // phones show a slice of each trunk; from ~430px up it widens until the
  // whole trunk (both bark edges) is inside the column
  const trunk = Math.round(width <= 430 ? Math.max(44, width * 0.135) : 58 + ((width - 430) / (MAX_WIDTH - 430)) * 46);
  const xLeft = Math.round(Math.max(width * 0.28, trunk + NODE_R + 22));
  return { width, trunk, xLeft, xRight: width - xLeft };
}

export interface PerchNode extends Pt {
  side: Side;
}

export interface UnitLayout {
  height: number;
  nodes: PerchNode[];
  /** where the route comes in from the sign above / leaves to the sign below */
  entry: Pt;
  exit: Pt;
}

export function unitLayout(count: number, startSide: Side, m: Metrics): UnitLayout {
  const nodes: PerchNode[] = [];
  for (let i = 0; i < count; i++) {
    const side: Side = (i % 2 === 0) === (startSide === 'L') ? 'L' : 'R';
    nodes.push({ side, x: side === 'L' ? m.xLeft : m.xRight, y: TOP + i * PITCH });
  }
  const height = TOP + Math.max(0, count - 1) * PITCH + BOTTOM;
  return { height, nodes, entry: { x: m.width / 2, y: 0 }, exit: { x: m.width / 2, y: height } };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A sagging rope bridge between two decks: "M a Q control b". */
export function bridgePath(a: Pt, b: Pt): string {
  const ax = a.x;
  const ay = a.y + DECK_DY;
  const bx = b.x;
  const by = b.y + DECK_DY;
  const dist = Math.hypot(bx - ax, by - ay);
  const sag = 10 + dist * 0.07;
  return `M ${r1(ax)} ${r1(ay)} Q ${r1((ax + bx) / 2)} ${r1((ay + by) / 2 + sag)} ${r1(bx)} ${r1(by)}`;
}

/**
 * The vine between a unit's edge (column centre) and its first/last perch. It
 * leaves the edge vertically so it lines up with the vine drawn behind the
 * unit sign.
 */
export function stubPath(a: Pt, b: Pt): string {
  // whichever end is the column-centre edge point keeps its y untouched; the
  // perch end is lowered to deck level
  const aEdge = a.y === 0;
  const ax = a.x;
  const ay = aEdge ? a.y : a.y + DECK_DY;
  const bx = b.x;
  const by = aEdge ? b.y + DECK_DY : b.y;
  const cx = aEdge ? ax : bx;
  const cy = aEdge ? ay + (by - ay) * 0.75 : ay + (by - ay) * 0.25;
  return `M ${r1(ax)} ${r1(ay)} Q ${r1(cx)} ${r1(cy)} ${r1(bx)} ${r1(by)}`;
}

/** Where the bird's feet go: the top of the token. */
export function perchPoint(node: Pt): Pt {
  return { x: node.x, y: node.y - NODE_R };
}

export interface FlightPlan {
  xs: number[];
  ys: number[];
  /** body tilt in degrees for each sample (already mirrored for facing) */
  tilts: number[];
  /** seconds */
  duration: number;
  /** 1 = flying right, -1 = flying left */
  facing: 1 | -1;
}

/** Arc flight between two perch points, sampled for keyframe animation. */
export function flightPlan(from: Pt, to: Pt, samples = 20): FlightPlan {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const lift = Math.min(130, Math.max(36, dist * 0.42));
  const cx = (from.x + to.x) / 2;
  // control point: above the higher end; a quadratic reaches half the control
  // offset, so double the lift
  const cy = Math.min(from.y, to.y) - lift * 2 + Math.abs(to.y - from.y) / 2;
  const facing: 1 | -1 = to.x >= from.x ? 1 : -1;
  const xs: number[] = [];
  const ys: number[] = [];
  const tilts: number[] = [];
  for (let i = 0; i <= samples; i++) {
    // ease in and out along the arc so takeoff and landing are gentle (the
    // keyframes are then played back linearly)
    const lin = i / samples;
    const t = lin < 0.5 ? 2 * lin * lin : 1 - 2 * (1 - lin) * (1 - lin);
    const u = 1 - t;
    xs.push(i === 0 ? from.x : i === samples ? to.x : r1(u * u * from.x + 2 * u * t * cx + t * t * to.x));
    ys.push(i === 0 ? from.y : i === samples ? to.y : r1(u * u * from.y + 2 * u * t * cy + t * t * to.y));
    // tangent → tilt: nose up while climbing, down while descending
    const dx = 2 * u * (cx - from.x) + 2 * t * (to.x - cx);
    const dy = 2 * u * (cy - from.y) + 2 * t * (to.y - cy);
    const ang = (Math.atan2(dy, Math.abs(dx) + 40) * 180) / Math.PI;
    tilts.push(i === samples ? 0 : r1(Math.max(-28, Math.min(28, ang)) * facing));
  }
  const duration = Math.round(Math.min(1.6, Math.max(0.7, dist / 240)) * 100) / 100;
  return { xs, ys, tilts, duration, facing };
}

/** Kinds of scenery that can fill the free side of a row. */
export const DECOR_KINDS = ['clump', 'fruit', 'shrooms', 'owl', 'nest', 'vine', 'lantern', 'fern', 'frog', 'blossom'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export interface DecorSlot extends Pt {
  side: Side;
  kind: DecorKind;
  /** 0..1 extra randomness for size/rotation variety */
  v: number;
}

/**
 * One decoration per row, on the side opposite that row's perch, hugging the
 * trunk. Seeded by the unit id so each unit differs but never changes between
 * renders.
 */
export function decorSlots(layout: UnitLayout, m: Metrics, seed: string): DecorSlot[] {
  const rng = mulberry32(hashString(`forest:${seed}`));
  let prev: DecorKind | null = null;
  return layout.nodes.map((n) => {
    const side: Side = n.side === 'L' ? 'R' : 'L';
    let kind = DECOR_KINDS[Math.floor(rng() * DECOR_KINDS.length)];
    if (kind === prev) kind = DECOR_KINDS[(DECOR_KINDS.indexOf(kind) + 1 + Math.floor(rng() * (DECOR_KINDS.length - 1))) % DECOR_KINDS.length];
    if (kind === prev) kind = DECOR_KINDS[(DECOR_KINDS.indexOf(kind) + 1) % DECOR_KINDS.length];
    prev = kind;
    const x = side === 'L' ? m.trunk : m.width - m.trunk;
    return { side, kind, x, y: n.y, v: rng() };
  });
}
