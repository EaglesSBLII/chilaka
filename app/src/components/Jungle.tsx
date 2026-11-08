// Cartoon jungle scenery behind the learning path. Pure SVG, no assets.
// Each section gets its own mood (fresh green → golden village → sunset fiesta)
// via a palette swap; dark mode dims everything through the .jungle-svg CSS.
// Foliage hugs the edges so path nodes stay readable.

interface Palette {
  leafDark: string;
  leaf: string;
  leafLight: string;
  accent: string; // flowers / fruit
  vine: string;
  glow: string; // soft radial wash behind the trail
}

const SECTION_PALETTES: Record<number, Palette> = {
  1: { leafDark: '#166b45', leaf: '#2fa568', leafLight: '#7fd6a4', accent: '#ff7ea0', vine: '#1e8552', glow: '#bff0d2' },
  2: { leafDark: '#2f6d22', leaf: '#5ba336', leafLight: '#a9d97b', accent: '#f5a623', vine: '#417f28', glow: '#f4e3b2' },
  3: { leafDark: '#14504f', leaf: '#2f8577', leafLight: '#79c9a9', accent: '#ff5c39', vine: '#226459', glow: '#ffd9c4' },
};

function paletteFor(section: number): Palette {
  return SECTION_PALETTES[((((section - 1) % 3) + 3) % 3) + 1];
}

/** Feathered palm frond: a curved stem with leaflet pairs. */
function Frond({ x, y, len, rotate, color, flip = false }: { x: number; y: number; len: number; rotate: number; color: string; flip?: boolean }) {
  const n = Math.max(5, Math.floor(len / 13));
  const leaflets = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const lx = t * len;
    const ly = -t * t * len * 0.22;
    const ll = 16 * (1 - t * 0.55);
    const ang = -38 - t * 16;
    leaflets.push(
      <g key={i}>
        <path d={`M${lx} ${ly} q ${ll * 0.5} ${-ll * 0.9} ${ll * 0.2} ${-ll * 1.5}`} stroke={color} strokeWidth={5.5 - t * 2.5} strokeLinecap="round" fill="none" transform={`rotate(${ang * 0.28} ${lx} ${ly})`} />
        <path d={`M${lx} ${ly} q ${ll * 0.6} ${ll * 0.7} ${ll * 0.25} ${ll * 1.4}`} stroke={color} strokeWidth={5.5 - t * 2.5} strokeLinecap="round" fill="none" transform={`rotate(${-ang * 0.1} ${lx} ${ly})`} />
      </g>,
    );
  }
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) ${flip ? 'scale(-1 1)' : ''}`}>
      <path d={`M0 0 Q ${len * 0.55} ${-len * 0.12} ${len} ${-len * 0.24}`} stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" />
      {leaflets}
    </g>
  );
}

/** Fat banana leaf with a midrib and notches. */
function BananaLeaf({ x, y, size, rotate, color, flip = false }: { x: number; y: number; size: number; rotate: number; color: string; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${flip ? -size : size} ${size})`}>
      <path
        d="M0 0 C 14 -26, 52 -34, 78 -18 C 96 -6, 96 12, 80 24 C 56 40, 18 36, 4 16 C 0 10, -2 4, 0 0 Z"
        fill={color}
      />
      <path d="M2 2 C 28 -2, 58 -2, 84 2" stroke="rgba(0,0,0,0.18)" strokeWidth="3" fill="none" strokeLinecap="round" />
      {[0.22, 0.42, 0.62, 0.82].map((t) => (
        <g key={t}>
          <path d={`M${6 + t * 70} ${0 - t * 4} L ${2 + t * 70} ${-20 + t * 6}`} stroke="rgba(255,255,255,0.22)" strokeWidth="2" strokeLinecap="round" />
          <path d={`M${8 + t * 70} ${2 - t * 2} L ${6 + t * 70} ${22 - t * 4}`} stroke="rgba(255,255,255,0.16)" strokeWidth="2" strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
}

/** Curly hanging vine with leaf pairs. */
function Vine({ x, height, color, leaves, sway = 0 }: { x: number; height: number; color: string; leaves: string; sway?: number }) {
  const n = Math.max(3, Math.floor(height / 26));
  return (
    <g>
      <path
        d={`M${x} 0 C ${x + 14 + sway} ${height * 0.3}, ${x - 14 - sway} ${height * 0.6}, ${x + 5} ${height}`}
        stroke={color}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      {Array.from({ length: n }, (_, i) => {
        const t = (i + 1) / (n + 1);
        const lx = x + Math.sin(t * Math.PI * 2) * (14 + sway);
        return (
          <g key={i}>
            <ellipse cx={lx - 9} cy={t * height} rx="11" ry="6" fill={leaves} transform={`rotate(-30 ${lx - 9} ${t * height})`} />
            <ellipse cx={lx + 9} cy={t * height + 10} rx="11" ry="6" fill={leaves} transform={`rotate(26 ${lx + 9} ${t * height + 10})`} />
          </g>
        );
      })}
      <circle cx={x + 5} cy={height + 4} r="4.5" fill={leaves} />
    </g>
  );
}

function Flower({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy="-7" rx="4" ry="6.5" fill={color} transform={`rotate(${a})`} />
      ))}
      <circle r="3.5" fill="#ffd75e" />
    </g>
  );
}

/**
 * Scenery for one unit block. `seed`ed by unit position so each unit's foliage
 * arrangement differs but is stable across renders.
 */
export function JungleScene({ section, seed }: { section: number; seed: number }) {
  const p = paletteFor(section);
  const r = (i: number) => {
    const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const H = 560;
  return (
    <svg
      viewBox={`0 0 400 ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full jungle-svg"
      aria-hidden="true"
    >
      <radialGradient id={`glow-${seed}`} cx="50%" cy="45%" r="62%">
        <stop offset="0%" stopColor={p.glow} stopOpacity="0.55" />
        <stop offset="100%" stopColor={p.glow} stopOpacity="0" />
      </radialGradient>
      <rect width="400" height={H} fill={`url(#glow-${seed})`} />

      {/* hanging vines */}
      <Vine x={26 + r(1) * 30} height={110 + r(2) * 80} color={p.vine} leaves={p.leaf} sway={r(3) * 8} />
      <Vine x={348 + r(4) * 26} height={150 + r(5) * 90} color={p.vine} leaves={p.leafDark} sway={r(6) * 8} />
      {r(7) > 0.4 && <Vine x={180 + r(8) * 44} height={64 + r(9) * 46} color={p.vine} leaves={p.leafLight} sway={r(10) * 6} />}

      {/* left edge: banana leaves + fronds bursting in */}
      <BananaLeaf x={-30} y={H * 0.2 + r(11) * 50} size={1.15} rotate={18 + r(12) * 14} color={p.leaf} />
      <BananaLeaf x={-38} y={H * 0.26 + r(13) * 50} size={0.85} rotate={-14 + r(14) * 12} color={p.leafLight} />
      <Frond x={-12} y={H * 0.5 + r(15) * 60} len={110} rotate={-18 + r(16) * 14} color={p.leafDark} />
      <Frond x={-16} y={H * 0.54 + r(17) * 60} len={80} rotate={16 + r(18) * 12} color={p.leaf} />
      <BananaLeaf x={-34} y={H * 0.8 + r(19) * 40} size={1} rotate={-8 + r(20) * 16} color={p.leafDark} />

      {/* right edge (mirrored) */}
      <BananaLeaf x={430} y={H * 0.3 + r(21) * 60} size={1.2} rotate={-16 - r(22) * 12} color={p.leafDark} flip />
      <Frond x={412} y={H * 0.44 + r(23) * 50} len={104} rotate={198 + r(24) * 14} color={p.leaf} />
      <BananaLeaf x={436} y={H * 0.62 + r(25) * 40} size={0.9} rotate={10 - r(26) * 14} color={p.leafLight} flip />
      <Frond x={410} y={H * 0.82 + r(27) * 30} len={84} rotate={188 + r(28) * 16} color={p.leafDark} />

      {/* ground fronds + bushes along the bottom */}
      <g>
        {Array.from({ length: 6 }, (_, i) => {
          const bx = 12 + i * 70 + r(30 + i) * 30;
          const col = [p.leafDark, p.leaf, p.leafLight][i % 3];
          return <Frond key={i} x={bx} y={H + 6} len={54 + r(38 + i) * 30} rotate={-64 - r(44 + i) * 22} color={col} />;
        })}
        {Array.from({ length: 4 }, (_, i) => {
          const bx = 40 + i * 96 + r(50 + i) * 40;
          const col = i % 2 ? p.leaf : p.leafDark;
          return <ellipse key={`b${i}`} cx={bx} cy={H - 4} rx={34 + r(54 + i) * 14} ry={16 + r(58 + i) * 8} fill={col} />;
        })}
      </g>

      {/* accents */}
      <Flower x={24 + r(60) * 26} y={H * 0.42 + r(61) * 90} size={1.05} color={p.accent} />
      <Flower x={372 - r(62) * 26} y={H * 0.58 + r(63) * 70} size={0.85} color={p.accent} />
      <Flower x={54 + r(64) * 40} y={H - 16 - r(65) * 10} size={0.9} color={p.accent} />
      {r(66) > 0.3 && (
        <g transform={`translate(${70 + r(67) * 260} ${H * 0.16 + r(68) * 60})`} opacity="0.95">
          <ellipse cx="-4.5" cy="0" rx="5.5" ry="8" fill={p.accent} transform="rotate(-26)" />
          <ellipse cx="4.5" cy="0" rx="5.5" ry="8" fill={p.accent} transform="rotate(26)" />
          <line x1="0" y1="-4" x2="0" y2="6" stroke="#5b4632" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

/**
 * Full-viewport jungle backdrop for the home screen. Fixed-position so the
 * trail scrolls over it like a scene. Density lives at the edges; the middle
 * column stays calm for readability.
 */
export function FullJungle({ section }: { section: number }) {
  const p = paletteFor(section);
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {/* sky → canopy wash */}
      <div
        className="absolute inset-0 jungle-sky"
        style={{
          background: `linear-gradient(180deg, var(--c-bg) 0%, ${p.glow}55 30%, ${p.leafLight}33 70%, ${p.leaf}44 100%)`,
        }}
      />
      {/* sun rays */}
      <svg className="absolute -top-10 left-1/2 h-[420px] w-[900px] -translate-x-1/2 jungle-svg" viewBox="0 0 900 420">
        {[-30, -12, 6, 24, 42].map((a) => (
          <path
            key={a}
            d="M450 -40 L430 460 L470 460 Z"
            fill="#ffd75e"
            opacity="0.1"
            transform={`rotate(${a} 450 0)`}
          />
        ))}
      </svg>
      {/* distant canopy silhouettes across the top */}
      <svg className="absolute inset-x-0 top-0 h-40 w-full jungle-svg" viewBox="0 0 400 100" preserveAspectRatio="none">
        <path d="M0 0 H400 V30 C 370 55, 340 20, 305 38 C 272 54, 250 22, 210 34 C 175 46, 150 18, 112 32 C 78 45, 50 20, 0 40 Z" fill={p.leafDark} opacity="0.5" />
        <path d="M0 0 H400 V18 C 356 38, 322 12, 282 24 C 246 34, 218 10, 178 20 C 142 30, 112 8, 76 18 C 46 26, 24 8, 0 22 Z" fill={p.leaf} opacity="0.55" />
      </svg>
      {/* left + right foliage columns */}
      <svg className="absolute left-0 top-0 h-full w-40 jungle-svg" viewBox="0 0 160 800" preserveAspectRatio="xMinYMid slice">
        <Vine x={26} height={190} color={p.vine} leaves={p.leaf} sway={6} />
        <BananaLeaf x={-46} y={230} size={1.5} rotate={16} color={p.leaf} />
        <BananaLeaf x={-58} y={300} size={1.1} rotate={-12} color={p.leafLight} />
        <Frond x={-16} y={430} len={130} rotate={-16} color={p.leafDark} />
        <BananaLeaf x={-50} y={540} size={1.3} rotate={8} color={p.leafDark} />
        <Frond x={-20} y={650} len={110} rotate={12} color={p.leaf} />
        <Flower x={30} y={370} size={1.1} color={p.accent} />
        <Flower x={44} y={700} size={0.9} color={p.accent} />
      </svg>
      <svg className="absolute right-0 top-0 h-full w-40 jungle-svg" viewBox="0 0 160 800" preserveAspectRatio="xMaxYMid slice">
        <Vine x={128} height={230} color={p.vine} leaves={p.leafDark} sway={8} />
        <BananaLeaf x={208} y={260} size={1.5} rotate={-18} color={p.leafDark} flip />
        <Frond x={176} y={400} len={126} rotate={196} color={p.leaf} />
        <BananaLeaf x={214} y={520} size={1.2} rotate={12} color={p.leafLight} flip />
        <Frond x={172} y={660} len={104} rotate={188} color={p.leafDark} />
        <Flower x={126} y={330} size={1} color={p.accent} />
        <Flower x={112} y={610} size={0.85} color={p.accent} />
      </svg>
      {/* dense understory along the bottom */}
      <svg className="absolute inset-x-0 bottom-0 h-36 w-full jungle-svg" viewBox="0 0 400 90" preserveAspectRatio="none">
        <path d="M0 90 V50 C 40 30, 80 55, 120 42 C 160 30, 200 52, 240 40 C 280 30, 320 54, 360 44 L 400 50 V90 Z" fill={p.leafDark} opacity="0.5" />
        <path d="M0 90 V64 C 50 48, 96 68, 144 58 C 190 50, 232 68, 278 60 C 320 52, 356 66, 400 60 V90 Z" fill={p.leaf} opacity="0.6" />
      </svg>
      {/* drifting fireflies */}
      {[
        { l: '12%', t: '30%', d: '9s', s: 5 },
        { l: '85%', t: '22%', d: '12s', s: 4 },
        { l: '8%', t: '68%', d: '11s', s: 4 },
        { l: '90%', t: '58%', d: '10s', s: 5 },
        { l: '20%', t: '85%', d: '13s', s: 3 },
        { l: '78%', t: '82%', d: '8s', s: 4 },
      ].map((f, i) => (
        <span
          key={i}
          className="firefly"
          style={{ left: f.l, top: f.t, width: f.s, height: f.s, animationDuration: f.d, animationDelay: `${i * 0.7}s` }}
        />
      ))}
      {/* a slow butterfly */}
      <svg className="butterfly jungle-svg" viewBox="0 0 24 24" style={{ animationDuration: '26s' }}>
        <ellipse cx="8" cy="12" rx="6" ry="8" fill={p.accent} transform="rotate(-20 8 12)" />
        <ellipse cx="16" cy="12" rx="6" ry="8" fill={p.accent} transform="rotate(20 16 12)" />
        <line x1="12" y1="5" x2="12" y2="19" stroke="#5b4632" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Wide leafy banner behind a section header. */
export function JungleCanopy({ section }: { section: number }) {
  const p = paletteFor(section);
  return (
    <svg viewBox="0 0 400 56" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full jungle-svg" aria-hidden="true">
      <rect width="400" height="56" fill={p.glow} opacity="0.5" />
      <path d="M0 0 H400 V20 C 360 38, 330 8, 295 24 C 262 38, 240 10, 205 22 C 172 34, 148 8, 112 22 C 80 34, 52 10, 0 26 Z" fill={p.leafDark} opacity="0.9" />
      <path d="M0 0 H400 V12 C 352 28, 322 4, 286 16 C 250 28, 224 4, 186 14 C 150 24, 120 2, 84 14 C 52 24, 30 4, 0 16 Z" fill={p.leaf} />
      <path d="M0 56 H400 V44 C 356 34, 322 52, 284 42 C 250 34, 220 52, 184 44 C 148 36, 116 52, 82 44 C 50 36, 28 50, 0 42 Z" fill={p.leafDark} opacity="0.55" />
      <circle cx="58" cy="18" r="4.5" fill={p.accent} />
      <circle cx="341" cy="14" r="3.8" fill={p.accent} />
      <circle cx="204" cy="16" r="3.2" fill="#ffd75e" />
    </svg>
  );
}
