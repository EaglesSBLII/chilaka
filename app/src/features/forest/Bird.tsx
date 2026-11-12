// Small Chikki for the forest map: the same parrot as components/Mascot.tsx
// (same colours, crest, beak and outfits) redrawn to read at ~46px, with a
// perched pose and a flying pose. Decorative: the lesson button under the bird
// carries the accessible name.

import type { MascotOutfit } from '../../components/Mascot';

export const BIRD_SIZE = 46;
/** where the feet are inside the sprite box, as [x, y] in px at BIRD_SIZE */
export const BIRD_FEET: [number, number] = [BIRD_SIZE / 2, Math.round((44 / 48) * BIRD_SIZE)];

function MiniOutfit({ outfit }: { outfit?: MascotOutfit }) {
  switch (outfit) {
    case 'scarf':
      return (
        <g>
          <path d="M18.5 21.5 Q27 26.5 36 20.5 L37 24 Q27 31 17.5 25.5 Z" fill="#C2185B" />
          <path d="M20 25 Q18 32 15.5 37 L20 36 Q22 31 23 26.5 Z" fill="#E91E63" />
        </g>
      );
    case 'garland':
      return (
        <g>
          <path d="M18 23 Q27 40 37 22" stroke="#2E9158" strokeWidth="1.4" fill="none" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const t = i / 6;
            return <circle key={i} cx={18 + t * 19} cy={23 + Math.sin(t * Math.PI) * 9} r="1.9" fill={i % 2 ? '#FFFFFF' : '#FFF59D'} stroke="#2E9158" strokeWidth="0.5" />;
          })}
        </g>
      );
    case 'glasses':
      return (
        <g stroke="#26221C" strokeWidth="1.3" fill="none">
          <circle cx="32" cy="14" r="4.6" fill="rgba(255,255,255,0.25)" />
          <path d="M27.4 14 h-3.4" />
          <path d="M36.6 13.6 l2.4 -0.8" />
        </g>
      );
    case 'crown':
      return (
        <g>
          <path d="M21 7.5 L23 0.5 L26.5 5 L29 -1 L31.5 5 L35 0.5 L36 7.5 Z" fill="#F5A623" stroke="#CF8A12" strokeWidth="0.8" strokeLinejoin="round" />
          <circle cx="29" cy="3.6" r="1.1" fill="#E4536B" />
        </g>
      );
    default:
      return null;
  }
}

/**
 * pose "perch": wings folded, feet down, gentle idle (CSS, see forest.css).
 * pose "fly": wings out and flapping, feet tucked.
 * facing: 1 looks right, -1 looks left.
 */
export function SmallChikki({
  pose,
  facing = 1,
  outfit,
  landing = false,
}: {
  pose: 'perch' | 'fly';
  facing?: 1 | -1;
  outfit?: MascotOutfit;
  landing?: boolean;
}) {
  const fly = pose === 'fly';
  return (
    <div
      className={`f-bird ${fly ? 'is-flying' : 'is-perched'} ${landing ? 'is-landing' : ''}`}
      style={{ width: BIRD_SIZE, height: BIRD_SIZE }}
      aria-hidden="true"
    >
      <svg width={BIRD_SIZE} height={BIRD_SIZE} viewBox="0 -2 48 50" fill="none" style={{ transform: `scaleX(${facing})`, overflow: 'visible' }}>
        <g className="f-bird-body">
          {/* far wing (flight only) */}
          {fly && <path className="f-wing f-wing-far" d="M24 24 Q20 6 8 2 Q11 14 16 27 Z" fill="#1F7A47" />}
          {/* tail */}
          <path d="M15 31 Q7 38 3.5 46 Q12 43.5 19 37 Z" fill="#2E9158" />
          <path d="M17.5 33 Q12 39 10 45 Q17 42 21.5 37 Z" fill="#3CB46E" />
          {/* feet */}
          {!fly && <path d="M21.5 40 v5 M21.5 45 l-2.2 1 M21.5 45 l2.2 1 M28.5 40 v5 M28.5 45 l-2.2 1 M28.5 45 l2.2 1" stroke="#D88E0F" strokeWidth="1.8" strokeLinecap="round" />}
          {/* body + belly */}
          <ellipse cx="25" cy="29" rx="12" ry="13" fill="#4CC97E" />
          <ellipse cx="27" cy="32" rx="8" ry="9" fill="#A8E6C1" />
          {/* head */}
          <g className="f-bird-head">
            <circle cx="28.5" cy="15" r="10.5" fill="#4CC97E" />
            <path d="M24.5 6 Q26.5 0.5 31 3.5 Q28.8 5.6 29 8 Q26.6 6 24.5 6" fill="#FF5C39" />
            <circle cx="33.5" cy="19" r="2.4" fill="#FF9E8A" opacity="0.55" />
            <circle cx="32" cy="14" r="3.4" fill="#fff" />
            <circle cx="32.8" cy="14.4" r="1.8" fill="#26221C" />
            <circle cx="33.5" cy="13.6" r="0.6" fill="#fff" />
            <g className="f-bird-lid">
              <circle cx="32" cy="14" r="3.7" fill="#3CB46E" />
              <path d="M29.4 14.6 q2.6 1.8 5.2 0" stroke="#26221C" strokeWidth="0.9" strokeLinecap="round" />
            </g>
            <path d="M38 12.5 Q46 14.5 43.3 19.6 Q39.2 21.6 36.8 17.6 Z" fill="#F5A623" />
            <path d="M38.6 16.6 Q41.4 17.6 43.4 17" stroke="#D88E0F" strokeWidth="0.8" strokeLinecap="round" />
          </g>
          <MiniOutfit outfit={outfit} />
          {/* near wing */}
          {fly ? (
            <path className="f-wing f-wing-near" d="M26 25 Q22 5 9 0 Q11 14 17 29 Z" fill="#2E9158" />
          ) : (
            <g>
              <path d="M14.5 27 Q13 20 20 20.5 Q26 22 25 31 Q23.5 38 17 39 Q14 34 14.5 27 Z" fill="#2E9158" />
              <path d="M17 26 Q20 29 19 35" stroke="#1F7A47" strokeWidth="1" strokeLinecap="round" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
