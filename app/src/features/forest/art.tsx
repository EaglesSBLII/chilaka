// Forest map artwork. Original vector art drawn in code: no image files.
//
// Every colour is a CSS custom property (--f-*) from forest.css, so day/night
// and the six grove palettes are pure CSS. Repeated pieces are defined once in
// <ForestDefs> and stamped with <use>, which keeps the DOM small.

import { memo, type ReactNode } from 'react';
import { hashString, mulberry32 } from '../../engine/rng';
import { bridgePath, DECK_DY, decorSlots, stubPath, type DecorSlot, type Metrics, type PerchNode, type Pt, type UnitLayout } from './layout';

const v = (name: string) => `var(--f-${name})`;

// ---------------------------------------------------------------- primitives

const LEAF = 'M0 0 C 7 -9, 24 -11, 36 0 C 24 9, 7 8, 0 0 Z';

function Leaf({ a, s = 1, x = 0, y = 0, tone, rib = true }: { a: number; s?: number; x?: number; y?: number; tone: 1 | 2 | 3 | 4; rib?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${a}) scale(${s})`}>
      <path d={LEAF} fill={v(`l${tone}`)} />
      {rib && <path d="M3 0 Q 18 -1.6 32 0" stroke={v('rib')} strokeWidth="1" fill="none" opacity="0.45" />}
    </g>
  );
}

function FlowerShape({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy="-5.6" rx="3.5" ry="5.4" fill={v('bloom')} transform={`rotate(${a})`} />
      ))}
      {[36, 108, 180, 252, 324].map((a) => (
        <path key={a} d="M0 -1 L0 -6" stroke={v('bloom-dark')} strokeWidth="0.8" strokeLinecap="round" transform={`rotate(${a - 36})`} />
      ))}
      <circle r="2.7" fill={v('pollen')} />
      <circle r="1.1" cx="-0.6" cy="-0.6" fill="#fff" opacity="0.6" />
    </g>
  );
}

/** A fan of leaves in four tones growing to the right from the origin. */
function ClumpShape() {
  return (
    <g>
      {[-80, -50, -20, 12, 44, 74].map((a) => (
        <Leaf key={`a${a}`} a={a} s={1.5} tone={1} rib={false} />
      ))}
      {[-64, -33, -2, 28, 58].map((a) => (
        <Leaf key={`b${a}`} a={a} s={1.26} tone={2} />
      ))}
      {[-44, -14, 16, 42].map((a) => (
        <Leaf key={`c${a}`} a={a} s={1} tone={3} />
      ))}
      {[-24, 6].map((a) => (
        <Leaf key={`d${a}`} a={a} s={0.72} tone={4} rib={false} />
      ))}
    </g>
  );
}

function SprayShape() {
  return (
    <g>
      <path d="M0 0 Q 20 -7 46 -5" stroke={v('bark-light')} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <Leaf a={-58} s={0.5} x={10} y={-2.5} tone={2} />
      <Leaf a={48} s={0.46} x={16} y={-3.6} tone={1} rib={false} />
      <Leaf a={-50} s={0.52} x={24} y={-5} tone={3} />
      <Leaf a={42} s={0.48} x={31} y={-5.4} tone={2} />
      <Leaf a={-36} s={0.5} x={38} y={-5.4} tone={4} rib={false} />
      <Leaf a={4} s={0.56} x={45} y={-5} tone={3} />
    </g>
  );
}

function VineShape() {
  // hangs straight down from the origin, ~58px
  return (
    <g>
      <path d="M0 0 C 6 14, -6 30, 1 46 C 3 51, 1 55, 0 58" stroke={v('vine')} strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <Leaf a={150} s={0.36} x={2} y={10} tone={3} />
      <Leaf a={24} s={0.36} x={2} y={15} tone={2} />
      <Leaf a={158} s={0.4} x={-2} y={26} tone={2} />
      <Leaf a={30} s={0.38} x={-1} y={32} tone={3} />
      <Leaf a={150} s={0.34} x={1} y={43} tone={4} rib={false} />
      <Leaf a={34} s={0.34} x={2} y={48} tone={2} />
      <FlowerShape y={60} s={0.62} />
    </g>
  );
}

const MANGO = 'M0 0 C 8 -2, 13 7, 9 16 C 5 23, -5 22, -7 14 C -9 6, -6 1, 0 0 Z';

function Mango({ x, y, r = 0 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <path d={MANGO} fill={v('fruit')} />
      <path d="M2 2 C 8 2, 11 8, 8 15 C 6 19, 1 20, -2 19 C 4 16, 6 8, 2 2 Z" fill={v('fruit2')} opacity="0.75" />
      <ellipse cx="-3" cy="8" rx="1.6" ry="3.6" fill="#fff" opacity="0.35" transform="rotate(14 -3 8)" />
    </g>
  );
}

// ------------------------------------------------------------------- <defs>

/**
 * Shared artwork. Rendered once per screen; unit scenery refers to these ids
 * with <use href="#fx-…">. Pieces that attach to a tree are drawn for the LEFT
 * tree (growing to the right) and mirrored for the right tree.
 */
export function ForestDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="fx-glow-lamp">
          <stop offset="0" style={{ stopColor: 'var(--f-lamp-glow)', stopOpacity: 0.75 }} />
          <stop offset="0.45" style={{ stopColor: 'var(--f-lamp-glow)', stopOpacity: 0.28 }} />
          <stop offset="1" style={{ stopColor: 'var(--f-lamp-glow)', stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id="fx-glow-shroom">
          <stop offset="0" style={{ stopColor: 'var(--f-shroom)', stopOpacity: 0.7 }} />
          <stop offset="1" style={{ stopColor: 'var(--f-shroom)', stopOpacity: 0 }} />
        </radialGradient>
        <g id="fx-clump">
          <ClumpShape />
        </g>
        <g id="fx-spray">
          <SprayShape />
        </g>
        <g id="fx-vine">
          <VineShape />
        </g>
        <g id="fx-flower">
          <FlowerShape />
        </g>

        {/* plank deck a token stands on; origin = deck centre */}
        <g id="fx-deck">
          <ellipse cx="0" cy="9" rx="43" ry="12" fill={v('bark-dark')} opacity="0.35" />
          <ellipse cx="0" cy="5" rx="44" ry="13" fill={v('plank-dark')} />
          <ellipse cx="0" cy="0" rx="44" ry="13" fill={v('plank')} />
          {[-30, -15, 0, 15, 30].map((x) => {
            const ye = 13 * Math.sqrt(1 - (x / 44) ** 2);
            return <path key={x} d={`M${x} ${-ye} L${x} ${ye + 5}`} stroke={v('plank-dark')} strokeWidth="1.2" opacity="0.6" />;
          })}
          <path d="M-40 -5 A 44 13 0 0 1 40 -5" stroke={v('plank-light')} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8" />
          {/* rope lashings at both ends */}
          <path d="M-41 -4 q-4 5 0 12 M-37 -7 q-4 6 0 15" stroke={v('rope')} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M41 -4 q4 5 0 12 M37 -7 q4 6 0 15" stroke={v('rope')} strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>

        {/* thatched roof + posts for the dialogue tree-house; origin = token centre */}
        <g id="fx-hut">
          <path d="M-33 -22 V30 M33 -22 V30" stroke={v('bark')} strokeWidth="5" strokeLinecap="round" />
          <path d="M-33 -22 V30 M33 -22 V30" stroke={v('bark-light')} strokeWidth="1.4" strokeLinecap="round" transform="translate(-1.2 0)" />
          <path d="M-50 -24 Q-26 -38 0 -62 Q26 -38 50 -24 Q26 -19 0 -20 Q-26 -19 -50 -24 Z" fill={v('thatch')} />
          <path d="M-50 -24 Q-26 -19 0 -20 Q26 -19 50 -24 L46 -18 Q24 -13 0 -14 Q-24 -13 -46 -18 Z" fill={v('thatch-dark')} />
          {[-34, -22, -10, 10, 22, 34].map((x) => (
            <path key={x} d={`M${x * 0.12} -56 Q${x * 0.7} -40 ${x} -22`} stroke={v('thatch-dark')} strokeWidth="1.3" fill="none" opacity="0.7" />
          ))}
          <path d="M-3 -60 Q0 -68 3 -60 Z" fill={v('thatch-dark')} />
          <path d="M0 -66 V-80" stroke={v('bark')} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M0 -80 L14 -76 L0 -71 Z" fill={v('bloom')} />
        </g>

        {/* mango cluster on a twig */}
        <g id="fx-fruit">
          <path d="M-2 0 Q 16 -8 40 -2" stroke={v('bark')} strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <path d="M14 -4 v8 M26 -5 v12 M37 -2 v6" stroke={v('vine')} strokeWidth="1.4" />
          <Mango x={14} y={4} r={6} />
          <Mango x={26} y={7} r={-4} />
          <Mango x={37} y={4} r={10} />
          <Leaf a={-40} s={0.6} x={8} y={-4} tone={2} />
          <Leaf a={-20} s={0.66} x={22} y={-7} tone={3} />
          <Leaf a={-64} s={0.5} x={30} y={-6} tone={1} rib={false} />
          <Leaf a={4} s={0.6} x={38} y={-3} tone={2} />
        </g>

        {/* shelf mushrooms growing out of the trunk edge */}
        <g id="fx-shrooms">
          {[
            [-17, 1],
            [0, 1.3],
            [16, 0.85],
          ].map(([y, s], i) => (
            <g key={i} transform={`translate(-3 ${y}) scale(${s})`}>
              <path d="M0 -3 Q 12 -9 23 -3 Q 26 2 20 3.4 Q 9 4.6 0 4 Z" fill={v('shroom')} />
              <path d="M0 4 Q 9 4.6 20 3.4 Q 14 8 0 7 Z" fill={v('shroom2')} />
              <circle cx="8" cy="-2.6" r="1.4" fill={v('shroom2')} opacity="0.7" />
              <circle cx="15" cy="-1.6" r="1" fill={v('shroom2')} opacity="0.7" />
            </g>
          ))}
          <circle cx="12" cy="1" r="30" fill="url(#fx-glow-shroom)" style={{ opacity: 'var(--f-glow)' }} />
        </g>

        {/* an owl in a hollow of the trunk (the hollow sits inside the trunk, left of the origin) */}
        <g id="fx-owl">
          <ellipse cx="-22" cy="0" rx="16" ry="20" fill={v('bark-dark')} />
          <ellipse cx="-22" cy="1" rx="13" ry="17" fill={v('hole')} />
          <path d="M-36 -8 A 16 20 0 0 1 -8 -8" stroke={v('bark-light')} strokeWidth="2" fill="none" strokeLinecap="round" />
          <ellipse cx="-22" cy="8" rx="9.5" ry="10.5" fill={v('owl')} />
          <path d="M-30 0 L-28 -6 L-24 -1 Z M-14 0 L-16 -6 L-20 -1 Z" fill={v('owl')} />
          <ellipse cx="-22" cy="12" rx="5.6" ry="6" fill={v('owl-belly')} />
          <circle cx="-26" cy="4" r="3.7" fill={v('eye')} />
          <circle cx="-18" cy="4" r="3.7" fill={v('eye')} />
          <circle cx="-26" cy="4.3" r="1.7" fill="#1d1712" />
          <circle cx="-18" cy="4.3" r="1.7" fill="#1d1712" />
          <path d="M-23.4 7 L-22 10 L-20.6 7 Z" fill="#F5A623" />
        </g>

        {/* a nest with eggs on a stub of branch */}
        <g id="fx-nest">
          <path d="M-4 6 Q 18 0 44 -2 L44 2 Q 18 8 -4 14 Z" fill={v('bark')} />
          <path d="M-2 7 Q 18 2 42 -1" stroke={v('bark-light')} strokeWidth="1.4" fill="none" />
          <ellipse cx="19" cy="-8" rx="4.4" ry="5.6" fill={v('egg')} transform="rotate(-14 19 -8)" />
          <ellipse cx="27" cy="-9" rx="4.4" ry="5.6" fill={v('egg')} />
          <ellipse cx="34" cy="-7.4" rx="4.2" ry="5.2" fill={v('egg')} transform="rotate(16 34 -7.4)" />
          <circle cx="26" cy="-10" r="0.8" fill={v('egg-dot')} />
          <circle cx="29" cy="-7.6" r="0.7" fill={v('egg-dot')} />
          <circle cx="19" cy="-9" r="0.7" fill={v('egg-dot')} />
          <path d="M9 -5 Q 26 10 44 -5 Q 42 6 26 7.4 Q 12 6 9 -5 Z" fill={v('nest')} />
          <path d="M11 -3 Q 26 8 42 -3 M14 2 Q 26 8 39 2 M8 -5 l-4 -2 M44 -5 l5 -3 M20 5 l-3 4 M33 5 l4 3" stroke={v('nest-dark')} strokeWidth="1.1" fill="none" strokeLinecap="round" />
          <Leaf a={-30} s={0.5} x={44} y={-2} tone={3} />
        </g>

        {/* a paper lantern on a hooked twig */}
        <g id="fx-lantern">
          <path d="M-2 0 Q 14 -12 30 -8" stroke={v('bark')} strokeWidth="3.6" fill="none" strokeLinecap="round" />
          <Leaf a={-50} s={0.44} x={12} y={-8} tone={2} />
          <path d="M30 -8 V4" stroke={v('rope')} strokeWidth="1.4" />
          <circle cx="30" cy="16" r="34" fill="url(#fx-glow-lamp)" style={{ opacity: 'var(--f-lamp-halo)' }} />
          <rect x="24" y="3" width="12" height="3.4" rx="1.4" fill={v('bark-dark')} />
          <path d="M22 7 Q30 5 38 7 Q41 16 38 25 Q30 27 22 25 Q19 16 22 7 Z" fill={v('lamp-body')} />
          <path d="M26.5 7 Q25 16 26.5 25 M33.5 7 Q35 16 33.5 25" stroke={v('lamp-rib')} strokeWidth="0.9" fill="none" />
          <ellipse cx="30" cy="16" rx="4" ry="6.4" fill={v('lamp-glow')} opacity="0.85" />
          <rect x="24" y="24.6" width="12" height="3" rx="1.2" fill={v('bark-dark')} />
          <path d="M30 27.6 v7 M28.4 31 v4 M31.6 31 v4" stroke={v('lamp-body')} strokeWidth="1" strokeLinecap="round" />
        </g>

        {/* ferns */}
        <g id="fx-fern">
          {(
            [
              [-52, 40, 2],
              [-16, 50, 3],
              [22, 42, 4],
            ] as [number, number, 1 | 2 | 3 | 4][]
          ).map(([rot, len, tone], k) => (
            <g key={k} transform={`rotate(${rot})`}>
              <path d={`M0 0 Q ${len * 0.5} ${-len * 0.2} ${len} ${-len * 0.06}`} stroke={v('vine')} strokeWidth="1.6" fill="none" strokeLinecap="round" />
              {Array.from({ length: 8 }, (_, i) => {
                const t = (i + 1) / 9;
                const x = t * len;
                const y = -Math.sin(t * Math.PI) * len * 0.1 - t * len * 0.06;
                const sc = 0.3 * (1 - t * 0.62);
                return (
                  <g key={i}>
                    <Leaf a={-64} s={sc} x={x} y={y} tone={tone} rib={false} />
                    <Leaf a={64} s={sc} x={x} y={y} tone={tone} rib={false} />
                  </g>
                );
              })}
            </g>
          ))}
        </g>

        {/* a tree frog on a broad leaf */}
        <g id="fx-frog">
          <Leaf a={8} s={1.55} tone={2} />
          <Leaf a={-32} s={1.1} tone={1} rib={false} />
          <g transform="translate(28 -1)">
            <path d="M-9 4 q-5 2 -7 6 M9 4 q5 2 7 6" stroke={v('frog-dark')} strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <ellipse cx="0" cy="0" rx="9.5" ry="6.6" fill={v('frog')} />
            <ellipse cx="0" cy="2.4" rx="6" ry="3.4" fill={v('frog-belly')} />
            <circle cx="-4.6" cy="-5.4" r="3.4" fill={v('frog')} />
            <circle cx="4.6" cy="-5.4" r="3.4" fill={v('frog')} />
            <circle cx="-4.6" cy="-5.8" r="2" fill="#fff" />
            <circle cx="4.6" cy="-5.8" r="2" fill="#fff" />
            <circle cx="-4.2" cy="-5.6" r="1" fill="#1d1712" />
            <circle cx="5" cy="-5.6" r="1" fill="#1d1712" />
            <path d="M-3.4 0.4 Q0 2.6 3.4 0.4" stroke={v('frog-dark')} strokeWidth="1" fill="none" strokeLinecap="round" />
          </g>
        </g>

        {/* a flowering twig */}
        <g id="fx-blossom">
          <path d="M-2 2 Q 14 -4 26 -16 M12 -2 Q 24 0 36 6" stroke={v('bark')} strokeWidth="3" fill="none" strokeLinecap="round" />
          <Leaf a={-70} s={0.56} x={10} y={-3} tone={2} />
          <Leaf a={20} s={0.6} x={22} y={2} tone={1} rib={false} />
          <Leaf a={-20} s={0.5} x={26} y={-16} tone={3} />
          <FlowerShape x={28} y={-18} s={1.25} />
          <FlowerShape x={38} y={7} s={1.05} />
          <FlowerShape x={15} y={-12} s={0.8} />
        </g>

        {/* trunk details */}
        <g id="fx-knot">
          <ellipse rx="9" ry="12" fill={v('bark-dark')} />
          <ellipse rx="6" ry="8.6" fill="none" stroke={v('groove')} strokeWidth="1.6" />
          <ellipse rx="2.6" ry="4" fill={v('groove')} />
          <path d="M-8 -9 A 9 12 0 0 1 8 -9" stroke={v('bark-light')} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
        <g id="fx-moss">
          <path d="M-2 -24 Q -14 -22 -17 -10 Q -24 -2 -18 8 Q -20 18 -9 22 Q -3 25 -1 18 Q 2 8 -1 0 Q 2 -12 -2 -24 Z" fill={v('moss')} />
          <path d="M-5 -16 Q -12 -12 -12 -4 M-8 4 Q -14 8 -11 15" stroke={v('moss-light')} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <circle cx="-6" cy="-6" r="1.5" fill={v('moss-light')} />
          <circle cx="-5" cy="11" r="1.3" fill={v('moss-light')} />
        </g>
        <g id="fx-ivy">
          <path d="M0 -44 C 9 -30, -9 -16, 0 0 C 8 14, -8 30, 0 44" stroke={v('vine')} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          {[-38, -26, -14, -2, 10, 22, 34].map((y, i) => (
            <Leaf key={y} a={i % 2 ? 160 : 20} s={0.42} x={i % 2 ? -3 : 3} y={y} tone={i % 3 === 0 ? 4 : i % 3 === 1 ? 2 : 3} rib={false} />
          ))}
        </g>

        {/* one tile of the distant forest (400 x 900) in two depths, repeated across the backdrop */}
        <g id="fx-far-back">
          <FarForest layer="back" />
        </g>
        <g id="fx-far-front">
          <FarForest layer="front" />
        </g>
      </defs>
    </svg>
  );
}

// ----------------------------------------------------------------- backdrop

function FarForest({ layer }: { layer: 'back' | 'front' }) {
  const rng = mulberry32(20261112);
  // a cluster of flat foliage pads, like the layered crown of a rain tree
  const pads = (key: string, cx: number, cy: number, size: number, fill: string, vines: boolean): ReactNode => (
    <g key={key} fill={fill}>
      <ellipse cx={cx} cy={cy} rx={size} ry={size * 0.36} />
      <ellipse cx={cx - size * 0.5} cy={cy - size * 0.22} rx={size * 0.62} ry={size * 0.3} />
      <ellipse cx={cx + size * 0.42} cy={cy - size * 0.3} rx={size * 0.7} ry={size * 0.32} />
      <ellipse cx={cx + size * 0.05} cy={cy - size * 0.5} rx={size * 0.5} ry={size * 0.26} />
      {vines && (
        <path
          d={`M${cx - size * 0.6} ${cy} q 3 ${size * 0.5} -1 ${size * 0.9} M${cx + size * 0.3} ${cy + 2} q -3 ${size * 0.7} 2 ${size * 1.3} M${cx + size * 0.7} ${cy - 2} q 3 ${size * 0.4} 0 ${size * 0.7}`}
          stroke={fill}
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </g>
  );
  const far: ReactNode[] = [];
  // farthest row: thin pale trunks with small crowns
  for (let i = 0; i < 9; i++) {
    const x = 16 + i * 43 + rng() * 14;
    const w = 8 + rng() * 8;
    far.push(<path key={`t${i}`} d={`M${x - w / 2} 900 L${x - w * 0.36} 0 H${x + w * 0.36} L${x + w / 2} 900 Z`} fill={v('far1')} />);
    for (let k = 0; k < 2; k++) {
      const by = 90 + k * 380 + rng() * 260;
      const dir = rng() > 0.5 ? 1 : -1;
      far.push(<path key={`tb${i}${k}`} d={`M${x} ${by} q ${dir * 12} -6 ${dir * 20} -22`} stroke={v('far1')} strokeWidth={w * 0.4} fill="none" strokeLinecap="round" />);
      far.push(pads(`tp${i}${k}`, x + dir * 22, by - 24, 16 + rng() * 9, v('far1'), false));
    }
  }
  const mid: ReactNode[] = [];
  // nearer row: broader trunks with layered crowns and hanging vines. Kept
  // inside the tile so copies sit side by side without a seam.
  const xs = [40, 122, 196, 276, 350];
  xs.forEach((bx, i) => {
    const x = bx + rng() * 12 - 6;
    const w = 18 + rng() * 14;
    mid.push(<path key={`m${i}`} d={`M${x - w / 2 - 4} 900 C ${x - w * 0.3} 640, ${x - w * 0.52} 300, ${x - w * 0.34} 0 H${x + w * 0.34} C ${x + w * 0.5} 300, ${x + w * 0.3} 640, ${x + w / 2 + 4} 900 Z`} fill={v('far2')} />);
    for (let k = 0; k < 4; k++) {
      const by = 110 + k * 200 + rng() * 110;
      const dir = (k + i) % 2 ? 1 : -1;
      const len = 22 + rng() * 16;
      mid.push(<path key={`mb${i}-${k}`} d={`M${x} ${by} q ${dir * len * 0.55} -4 ${dir * len} -26`} stroke={v('far2')} strokeWidth={w * 0.32} fill="none" strokeLinecap="round" />);
      mid.push(pads(`mp${i}-${k}`, x + dir * (len + 4), by - 30, 24 + rng() * 10, v('far2'), true));
    }
  });
  // a few birds far off
  const birds = [
    [70, 150, 1],
    [96, 168, 0.7],
    [300, 250, 0.9],
  ].map(([x, y, s], i) => <path key={`bd${i}`} d={`M${x} ${y} q ${5 * s} ${-6 * s} ${10 * s} 0 q ${5 * s} ${-6 * s} ${10 * s} 0`} stroke={v('far3')} strokeWidth="1.6" fill="none" strokeLinecap="round" />);
  if (layer === 'back') {
    return (
      <>
        {/* canopy roof */}
        <path d="M0 0 H400 V62 C 372 84, 344 44, 312 64 C 282 84, 256 44, 222 62 C 190 80, 160 40, 126 60 C 96 78, 66 44, 38 62 C 22 72, 10 58, 0 62 Z" fill={v('far1')} />
        {far}
      </>
    );
  }
  return (
    <>
      <path d="M0 0 H400 V38 C 366 60, 336 24, 300 42 C 268 58, 240 26, 204 40 C 170 54, 142 22, 108 38 C 78 52, 48 26, 22 40 C 12 46, 6 36, 0 38 Z" fill={v('far2')} />
      {mid}
      {birds}
      {/* understory */}
      <path d="M0 900 V840 C 40 812, 80 846, 124 828 C 168 812, 204 846, 248 830 C 290 814, 330 846, 368 832 C 384 826, 394 836, 400 840 V900 Z" fill={v('far2')} />
      <path d="M0 900 V866 C 50 846, 96 874, 146 860 C 192 848, 236 874, 282 862 C 324 852, 364 872, 400 866 V900 Z" fill={v('far3')} />
    </>
  );
}

/** Stars as one element: a stack of tiny radial gradients. */
const STARS_BG = Array.from({ length: 40 }, (_, i) => {
  const r = mulberry32(977 + i * 31);
  const size = (0.7 + r() * 1.1).toFixed(1);
  return `radial-gradient(${size}px ${size}px at ${(r() * 100).toFixed(1)}% ${(r() * 100).toFixed(1)}%, rgb(255 255 255 / ${(0.5 + r() * 0.5).toFixed(2)}) 55%, transparent 100%)`;
}).join(',');

const MOTES = [
  { l: '10%', t: '26%', d: '9s', s: 5 },
  { l: '86%', t: '18%', d: '12s', s: 4 },
  { l: '6%', t: '64%', d: '11s', s: 4 },
  { l: '92%', t: '52%', d: '10s', s: 5 },
  { l: '18%', t: '84%', d: '13s', s: 4 },
  { l: '74%', t: '78%', d: '8s', s: 5 },
  { l: '46%', t: '40%', d: '14s', s: 4 },
];

/**
 * The distant forest, fixed to the viewport so the map scrolls over it.
 * Static apart from a handful of drifting motes (fireflies at night).
 */
export function ForestBackdrop() {
  // enough tiles to cover a wide desktop window at any height
  const tiles = [0, 1, 2, 3, 4, 5];
  return (
    <div className="forest-vars f-backdrop" aria-hidden="true">
      <div className="f-stars" style={{ backgroundImage: STARS_BG }} />
      <div className="f-far-row">
        {tiles.map((i) => (
          <svg key={i} viewBox="0 0 400 900" preserveAspectRatio="none">
            <use href="#fx-far-back" />
          </svg>
        ))}
      </div>
      <div className="f-sun" />
      <svg className="f-shafts" viewBox="0 0 900 600" preserveAspectRatio="none">
        {[-34, -20, -7, 6, 19, 33].map((a, i) => (
          <path key={a} d={`M450 -80 L${418 - (i % 2) * 10} 760 L${486 + (i % 3) * 8} 760 Z`} fill={v('shaft')} opacity={0.16 + (i % 3) * 0.07} transform={`rotate(${a} 450 -80)`} />
        ))}
      </svg>
      <div className="f-far-row">
        {tiles.map((i) => (
          <svg key={i} viewBox="0 0 400 900" preserveAspectRatio="none">
            <use href="#fx-far-front" />
          </svg>
        ))}
      </div>
      <div className="f-haze" />
      {MOTES.map((f, i) => (
        <span key={i} className="f-mote" style={{ left: f.l, top: f.t, width: f.s, height: f.s, animationDuration: f.d, animationDelay: `${-i * 1.3}s` }} />
      ))}
      <svg className="f-butterfly" viewBox="0 0 24 24">
        <ellipse cx="8" cy="11" rx="6" ry="8" fill={v('bloom')} transform="rotate(-20 8 11)" />
        <ellipse cx="16" cy="11" rx="6" ry="8" fill={v('bloom')} transform="rotate(20 16 11)" />
        <ellipse cx="8.4" cy="12" rx="2.6" ry="4" fill={v('pollen')} transform="rotate(-20 8 11)" />
        <ellipse cx="15.6" cy="12" rx="2.6" ry="4" fill={v('pollen')} transform="rotate(20 16 11)" />
        <line x1="12" y1="5" x2="12" y2="18" stroke="#4b3826" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// -------------------------------------------------------------- trunk tiles

const TRUNK_PALETTES = {
  day: { bark: '#8b5e3c', light: '#b58258', dark: '#6a4429', groove: '#553520' },
  night: { bark: '#3d2f2c', light: '#5a473f', dark: '#2a1f1d', groove: '#1c1413' },
};

/**
 * One 120x600 bark tile for the LEFT trunk (the right one is mirrored), as a
 * CSS url(). The inner edge (facing the route) waves around x=108, the outer
 * edge around x=10; phones only show the inner part.
 */
function trunkTile(side: 'L' | 'R', theme: 'day' | 'night'): string {
  const p = TRUNK_PALETTES[theme];
  const body =
    `<path d='M10 0C4 100 16 200 9 300C3 400 15 500 10 600H108C102 510 116 410 109 300C101 190 115 90 108 0Z' fill='${p.bark}'/>` +
    `<path d='M10 0C4 100 16 200 9 300C3 400 15 500 10 600H58C64 500 52 400 60 300C66 200 54 100 58 0Z' fill='${p.dark}' opacity='.5'/>` +
    `<path d='M10 0C4 100 16 200 9 300C3 400 15 500 10 600H17C22 500 10 400 16 300C23 200 11 100 17 0Z' fill='${p.groove}' opacity='.55'/>` +
    `<path d='M108 0C115 90 101 190 109 300C116 410 102 510 108 600H100C94 510 108 410 101 300C93 190 107 90 100 0Z' fill='${p.light}'/>` +
    `<g fill='none' stroke='${p.groove}' stroke-linecap='round'>` +
    `<path stroke-width='2.4' d='M84 0C90 80 78 170 85 300C91 420 79 520 84 600'/>` +
    `<path stroke-width='2' d='M68 0C73 120 62 240 69 300C75 380 64 500 68 600'/>` +
    `<path stroke-width='1.8' d='M48 0C52 150 44 300 48 450C50 520 46 560 48 600'/>` +
    `<path stroke-width='1.6' d='M95 36C99 110 91 170 95 250M94 330C98 400 90 470 94 560'/>` +
    `<path stroke-width='1.6' d='M76 70C80 120 73 160 77 210M77 380C81 430 74 480 78 540'/>` +
    `<path stroke-width='1.4' d='M58 150C61 200 55 250 59 300M58 440C61 480 55 520 58 570M32 60C35 140 29 220 32 300M33 360C36 440 30 520 33 590'/>` +
    `<path stroke-width='1.4' d='M86 120q6 4 9 0M70 250q7 5 13 0M87 420q5 4 8 0M50 340q8 5 16 0M69 520q7 5 14 0M50 80q8 4 16 0M30 200q8 5 16 0M34 470q7 4 13 0'/>` +
    `</g>` +
    `<g fill='none' stroke='${p.light}' stroke-linecap='round' opacity='.55'>` +
    `<path stroke-width='1.2' d='M87.5 20C92 90 82 170 88 280M72 320C77 390 67 480 71 580M98 270C100 290 98 310 99 325M51.5 30C55 120 48 200 51 280'/>` +
    `</g>`;
  const inner = side === 'L' ? body : `<g transform='translate(120 0) scale(-1 1)'>${body}</g>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='600' viewBox='0 0 120 600'>${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** CSS variables carrying the trunk tiles; forest.css picks day or night. */
export const TRUNK_VARS: Record<string, string> = {
  '--f-trunk-l-day': trunkTile('L', 'day'),
  '--f-trunk-r-day': trunkTile('R', 'day'),
  '--f-trunk-l-night': trunkTile('L', 'night'),
  '--f-trunk-r-night': trunkTile('R', 'night'),
};

// ------------------------------------------------------------ unit scenery

function Use({ id, x = 0, y = 0, s = 1, sy, r = 0, opacity }: { id: string; x?: number; y?: number; s?: number; sy?: number; r?: number; opacity?: number }) {
  return <use href={`#fx-${id}`} transform={`translate(${x} ${y}) rotate(${r}) scale(${s} ${sy ?? s})`} opacity={opacity} />;
}

/** Mirror a group across the column so art drawn for the left tree fits the right one. */
function Mirror({ on, width, children }: { on: boolean; width: number; children: ReactNode }) {
  return <g transform={on ? `translate(${width} 0) scale(-1 1)` : undefined}>{children}</g>;
}

/** Branch from the left trunk carrying a deck at (x, y). Drawn in left-tree coordinates. */
function Branch({ x, y, trunk, locked, seed }: { x: number; y: number; trunk: number; locked: boolean; seed: number }) {
  const dy = y + DECK_DY;
  const tx = trunk - 8;
  const ty = dy + 26;
  const tipX = x + 58;
  const tipY = dy - 6;
  const top = `M${tx} ${ty - 11} Q ${x - 18} ${dy + 20} ${x + 6} ${dy + 9} Q ${x + 36} ${dy + 4} ${tipX} ${tipY}`;
  const d = `${top} L${tipX + 1} ${tipY + 3} Q ${x + 34} ${dy + 13} ${x + 6} ${dy + 19} Q ${x - 16} ${dy + 32} ${tx} ${ty + 11} Z`;
  return (
    <g opacity={locked ? 0.72 : 1}>
      {/* strut under the deck */}
      <path d={`M${tx} ${ty + 40} Q ${x - 24} ${dy + 38} ${x - 6} ${dy + 14}`} stroke={v('bark-dark')} strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d={`M${tx} ${ty + 38} Q ${x - 25} ${dy + 36} ${x - 8} ${dy + 14}`} stroke={v('bark')} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8" />
      <path d={d} fill={v('bark')} />
      <path d={top} stroke={v('bark-light')} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d={`M${tx + 6} ${ty + 6} Q ${x - 14} ${dy + 28} ${x + 4} ${dy + 17}`} stroke={v('groove')} strokeWidth="1.4" fill="none" opacity="0.6" />
      {/* leaves where the branch leaves the trunk, and at the tip */}
      <Use id="clump" x={trunk - 4} y={ty - 16} s={0.5} r={-42 + (seed % 3) * 10} />
      <Use id="spray" x={tipX - 6} y={tipY + 1} s={0.9} r={-16 + (seed % 4) * 7} />
      <Use id="spray" x={tipX - 12} y={tipY + 3} s={0.72} r={24 + (seed % 5) * 4} />
      <use href="#fx-deck" transform={`translate(${x} ${dy})`} />
    </g>
  );
}

/** One piece of scenery on the free side of a row, in left-tree coordinates (origin = trunk edge at row height). */
function Decor({ slot, lampLit }: { slot: DecorSlot; lampLit: boolean }) {
  const { kind, v: rnd } = slot;
  switch (kind) {
    case 'clump':
      return (
        <g>
          <Use id="clump" x={-6} y={-2} s={0.74 + rnd * 0.1} r={-10 + rnd * 20} />
          <Use id="flower" x={20 + rnd * 12} y={-16 + rnd * 20} s={0.9} />
        </g>
      );
    case 'fruit':
      return (
        <g>
          <Use id="clump" x={-6} y={-16} s={0.5} r={-24} />
          <Use id="fruit" x={-2} y={-10} s={1.02} r={4 + rnd * 8} />
        </g>
      );
    case 'shrooms':
      return (
        <g>
          <Use id="shrooms" x={-2} y={-2} s={1 + rnd * 0.15} />
          <Use id="moss" x={-4} y={30} s={0.8} />
        </g>
      );
    case 'owl':
      return (
        <g>
          <Use id="owl" x={-2} y={-4} />
          <Use id="spray" x={-6} y={22} s={0.8} r={10} />
        </g>
      );
    case 'nest':
      return <Use id="nest" x={-2} y={2} s={1} r={-4 + rnd * 6} />;
    case 'vine':
      return (
        <g>
          <path d="M-4 -34 Q 18 -40 46 -32" stroke={v('bark')} strokeWidth="4" fill="none" strokeLinecap="round" />
          <Use id="clump" x={-6} y={-36} s={0.42} r={-30} />
          <Use id="vine" x={14} y={-36} s={0.9} />
          <Use id="vine" x={30} y={-35} s={0.66 + rnd * 0.2} />
          <Use id="vine" x={43} y={-33} s={0.5} />
        </g>
      );
    case 'lantern':
      return (
        <g className={lampLit ? undefined : 'f-lamp-off'}>
          <Use id="lantern" x={-2} y={-18} s={1.05} />
        </g>
      );
    case 'fern':
      return (
        <g>
          <Use id="fern" x={-4} y={8} s={1} r={-8 + rnd * 10} />
          <Use id="flower" x={8} y={12} s={0.7} />
        </g>
      );
    case 'frog':
      return <Use id="frog" x={-6} y={4} s={0.98} r={-6 + rnd * 8} />;
    case 'blossom':
      return (
        <g>
          <Use id="clump" x={-6} y={4} s={0.46} r={10} />
          <Use id="blossom" x={-2} y={2} s={1.05} />
        </g>
      );
  }
}

/** A built bridge (ropes + planks) or, if not reached yet, a bare vine. */
function Bridge({ a, b, open }: { a: Pt; b: Pt; open: boolean }) {
  const d = bridgePath(a, b);
  if (!open) return <path d={d} className="f-vine-bare" />;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / len) * 7.5;
  const ny = ((b.x - a.x) / len) * 7.5;
  return (
    <g>
      <path d={d} className="f-planks" />
      <path d={d} className="f-plank-edge" />
      <path d={d} className="f-rope" transform={`translate(${nx} ${ny})`} />
      <path d={d} className="f-rope" transform={`translate(${-nx} ${-ny})`} />
      <path d={d} className="f-rope f-rope-hand" transform="translate(0 -14)" />
    </g>
  );
}

export interface SceneryProps {
  unitId: string;
  m: Metrics;
  layout: UnitLayout;
  /** per node: can the learner reach it (not locked)? */
  open: boolean[];
  /** index of the dialogue node in layout.nodes, or -1 */
  hutIndex: number;
  /** the route into this unit / out of it is open */
  entryOpen: boolean;
  exitOpen: boolean;
  /** lanterns in this unit are lit (unit reached) */
  lit: boolean;
}

/**
 * Everything drawn behind one unit's tokens: trunk details, branches, decks,
 * bridges and the decoration on the free side of each row. Mounted only while
 * the unit is near the viewport.
 */
export const UnitScenery = memo(function UnitScenery({ unitId, m, layout, open, hutIndex, entryOpen, exitOpen, lit }: SceneryProps) {
  const { width, trunk } = m;
  const nodes = layout.nodes;
  const slots = decorSlots(layout, m, unitId);
  const rng = mulberry32(hashString(`trunk:${unitId}`));
  const details: ReactNode[] = [];
  // between rows: something on each trunk (knot, moss, ivy, or leaves leaning in from outside)
  for (let i = 0; i <= nodes.length; i++) {
    const y = (nodes[i]?.y ?? nodes[nodes.length - 1].y + 100) - 50;
    (['L', 'R'] as const).forEach((side) => {
      const k = Math.floor(rng() * 5);
      const jitter = rng() * 16 - 8;
      const inner = (
        <>
          {k === 0 && <Use id="knot" x={trunk - 26} y={y + jitter} s={0.9 + rng() * 0.3} />}
          {k === 1 && <Use id="moss" x={trunk - 2} y={y + jitter} s={1 + rng() * 0.3} />}
          {k === 2 && <Use id="ivy" x={trunk - 14} y={y + jitter} s={1} r={rng() * 8 - 4} />}
          {k === 3 && <Use id="clump" x={-10} y={y + jitter} s={0.78} r={rng() * 30 - 15} />}
        </>
      );
      details.push(
        <Mirror key={`${i}${side}`} on={side === 'R'} width={width}>
          {inner}
        </Mirror>,
      );
    });
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  return (
    <svg className="f-scenery" width={width} height={layout.height} viewBox={`0 0 ${width} ${layout.height}`} aria-hidden="true" focusable="false">
      {details}
      {slots.map((s, i) => (
        <Mirror key={`d${i}`} on={s.side === 'R'} width={width}>
          <g transform={`translate(${trunk} ${s.y})`}>
            <Decor slot={s} lampLit={lit} />
          </g>
        </Mirror>
      ))}
      {nodes.map((n: PerchNode, i) => (
        <Mirror key={`b${i}`} on={n.side === 'R'} width={width}>
          <Branch x={m.xLeft} y={n.y} trunk={trunk} locked={!open[i]} seed={i + unitId.length} />
        </Mirror>
      ))}
      {/* the route */}
      <path d={stubPath(layout.entry, first)} className={entryOpen ? 'f-liana' : 'f-vine-bare'} />
      {entryOpen && <path d={stubPath(layout.entry, first)} className="f-liana-hi" />}
      {nodes.slice(1).map((n, i) => (
        <Bridge key={`r${i}`} a={nodes[i]} b={n} open={open[i] && open[i + 1]} />
      ))}
      <path d={stubPath(last, layout.exit)} className={exitOpen ? 'f-liana' : 'f-vine-bare'} />
      {exitOpen && <path d={stubPath(last, layout.exit)} className="f-liana-hi" />}
      {/* decks again, over the bridge ends, so bridges tuck under them */}
      {nodes.map((n, i) => (
        <use key={`k${i}`} href="#fx-deck" transform={`translate(${n.x} ${n.y + DECK_DY})`} opacity={open[i] ? 1 : 0.8} />
      ))}
      {hutIndex >= 0 && <use href="#fx-hut" transform={`translate(${nodes[hutIndex].x} ${nodes[hutIndex].y})`} />}
    </svg>
  );
});

// ------------------------------------------------------------- section gate

/** The great bough and canopy that mark the start of a section. Drawn at 1:1 for the column width. */
export const GateArt = memo(function GateArt({ m, seed }: { m: Metrics; seed: number }) {
  const { width: W, trunk } = m;
  const rng = mulberry32(seed * 7919 + 13);
  const x0 = trunk - 12;
  const x1 = W - trunk + 12;
  const bough = `M${x0} 70 Q ${W / 2} 34 ${x1} 64`;
  const n = Math.max(5, Math.round((x1 - x0) / 46));
  const clumps: ReactNode[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + t * (x1 - x0);
    const y = 68 - Math.sin(t * Math.PI) * 17;
    clumps.push(<Use key={`a${i}`} id="clump" x={x} y={y + 2} s={0.95 + rng() * 0.35} r={-90 + (rng() * 40 - 20)} />);
  }
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + t * (x1 - x0);
    const y = 70 - Math.sin(t * Math.PI) * 17;
    clumps.push(<Use key={`b${i}`} id="clump" x={x} y={y + 8} s={0.6 + rng() * 0.2} r={-90 + (rng() * 70 - 35)} />);
  }
  const flowers: ReactNode[] = [];
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.3 + rng() * 0.4) / 6;
    flowers.push(<Use key={i} id="flower" x={x0 + t * (x1 - x0)} y={30 + rng() * 26 - Math.sin(t * Math.PI) * 14} s={0.9 + rng() * 0.5} />);
  }
  return (
    <svg className="f-gate-art" width={W} height={150} viewBox={`0 0 ${W} 150`} aria-hidden="true" focusable="false">
      {/* dark mass behind the crown so the gate reads as one canopy */}
      <path d={`M${x0 - 10} 66 Q ${W * 0.25} -6 ${W / 2} 6 Q ${W * 0.75} -8 ${x1 + 10} 60 Q ${W / 2} 40 ${x0 - 10} 66 Z`} fill={v('l1')} />
      {clumps}
      {/* crowns that wrap the two trunks so they rise out of the canopy */}
      {[0, 1].map((k) => (
        <Mirror key={k} on={k === 1} width={W}>
          <path d={`M-12 74 Q -16 4 ${trunk * 0.5} -14 Q ${trunk + 26} -2 ${trunk + 20} 70 Q ${trunk * 0.5} 54 -12 74 Z`} fill={v('l1')} />
          <Use id="clump" x={trunk * 0.5} y={46} s={1.5} r={-90 + (k ? 8 : -8)} />
          <Use id="clump" x={2} y={52} s={1.1} r={-120} />
          <Use id="clump" x={trunk + 4} y={50} s={1} r={-58} />
          <Use id="clump" x={trunk * 0.5} y={64} s={0.9} r={-90} />
        </Mirror>
      ))}
      {/* ropes that carry the plaque */}
      <path d={`M${W / 2 - 78} 50 V104 M${W / 2 + 78} 50 V104`} stroke={v('rope')} strokeWidth="3" strokeLinecap="round" />
      <path d={bough} stroke={v('bark-dark')} strokeWidth="19" fill="none" strokeLinecap="round" transform="translate(0 3)" />
      <path d={bough} stroke={v('bark')} strokeWidth="17" fill="none" strokeLinecap="round" />
      <path d={bough} stroke={v('bark-light')} strokeWidth="2.4" fill="none" strokeLinecap="round" transform="translate(0 -5)" opacity="0.9" />
      <path d={bough} stroke={v('groove')} strokeWidth="1.4" fill="none" strokeDasharray="26 14 40 18" transform="translate(0 2)" opacity="0.6" />
      {/* rope wraps */}
      {[W / 2 - 78, W / 2 + 78].map((x) => (
        <path key={x} d={`M${x - 5} ${44} v16 M${x} ${43} v17 M${x + 5} ${44} v16`} stroke={v('rope')} strokeWidth="2.6" strokeLinecap="round" />
      ))}
      {flowers}
      {/* vines and lanterns hanging from the bough */}
      <Use id="vine" x={trunk + 16} y={72} s={1.05} />
      <Use id="vine" x={trunk + 30} y={68} s={0.7} />
      <Use id="vine" x={W - trunk - 16} y={68} s={1.1} />
      <Use id="vine" x={W - trunk - 32} y={64} s={0.66} />
    </svg>
  );
});

/** Bunting hung across a finished unit's pole. */
export function Bunting({ width }: { width: number }) {
  const n = Math.max(6, Math.round(width / 30));
  const flags: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 0.8) / n;
    const y = (t: number) => 2 + Math.sin(t * Math.PI) * 9;
    const xa = t0 * width + 3;
    const xb = t1 * width + 3;
    flags.push(<path key={i} d={`M${xa} ${y(t0)} L${xb} ${y(t1)} L${(xa + xb) / 2} ${y((t0 + t1) / 2) + 13} Z`} fill={i % 3 === 0 ? 'var(--c-accent)' : i % 3 === 1 ? 'var(--c-teal)' : 'var(--c-flame)'} />);
  }
  return (
    <svg className="f-bunting" width={width} height={26} viewBox={`0 0 ${width} 26`} aria-hidden="true" focusable="false">
      <path d={`M0 2 Q ${width / 2} 20 ${width} 2`} stroke={v('rope')} strokeWidth="1.6" fill="none" />
      {flags}
    </svg>
  );
}
