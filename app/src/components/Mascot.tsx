// Chikki the parrot (చిలక) — the app mascot. Pure SVG, five poses.

import { useApp } from '../store';

export type MascotPose = 'idle' | 'cheer' | 'teach' | 'sleepy' | 'celebrate';
export type MascotOutfit = 'scarf' | 'garland' | 'glasses' | 'crown';

/** The outfit equipped on the profile (shop purchase), if any. */
export function useMascotOutfit(): MascotOutfit | undefined {
  return useApp((s) => s.profile?.outfit) as MascotOutfit | undefined;
}

function Outfit({ outfit }: { outfit?: MascotOutfit }) {
  switch (outfit) {
    case 'scarf':
      return (
        <g>
          <path d="M40 54 Q58 66 84 52 L86 60 Q60 74 38 62 Z" fill="#C2185B" />
          <path d="M44 60 Q40 78 34 90 L44 88 Q48 74 50 62 Z" fill="#E91E63" />
          <path d="M42 58 Q58 68 82 56" stroke="#F8BBD0" strokeWidth="1.5" fill="none" strokeDasharray="2 3" />
        </g>
      );
    case 'garland':
      return (
        <g>
          <path d="M38 58 Q62 100 86 56" stroke="#2E9158" strokeWidth="3" fill="none" />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
            const t = i / 8;
            const x = 38 + t * 48;
            const y = 58 + Math.sin(t * Math.PI) * 38;
            return <circle key={i} cx={x} cy={y} r="3.4" fill={i % 2 ? '#FFFFFF' : '#FFF59D'} stroke="#2E9158" strokeWidth="0.8" />;
          })}
        </g>
      );
    case 'glasses':
      return (
        <g stroke="#26221C" strokeWidth="2.2" fill="none">
          <circle cx="66" cy="30" r="9.5" fill="rgba(255,255,255,0.25)" />
          <circle cx="44" cy="30" r="9.5" fill="rgba(255,255,255,0.25)" />
          <path d="M53.5 30 h3" />
          <path d="M75.5 29 l6 -2" />
        </g>
      );
    case 'crown':
      return (
        <g>
          <path d="M40 16 L46 2 L54 12 L60 -2 L66 12 L74 2 L80 16 Z" fill="#F5A623" stroke="#CF8A12" strokeWidth="1.5" strokeLinejoin="round" />
          <rect x="40" y="14" width="40" height="5" rx="2" fill="#CF8A12" />
          <circle cx="60" cy="8" r="2.2" fill="#E4536B" />
          <circle cx="47" cy="10" r="1.6" fill="#17A196" />
          <circle cx="73" cy="10" r="1.6" fill="#17A196" />
        </g>
      );
    default:
      return null;
  }
}

export function Mascot({ pose = 'idle', size = 120, outfit }: { pose?: MascotPose; size?: number; outfit?: MascotOutfit | null }) {
  const equipped = useMascotOutfit();
  const worn = outfit === null ? undefined : (outfit ?? equipped);
  const wingFlap = pose === 'cheer' || pose === 'celebrate';
  const eyesClosed = pose === 'sleepy';
  const openBeak = pose === 'teach' || pose === 'celebrate';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 -6 120 126"
      fill="none"
      role="img"
      aria-label="Chikki the parrot"
      className={pose === 'celebrate' ? 'animate-pop' : undefined}
    >
      {/* tail */}
      <path d="M38 78 Q20 96 14 112 Q34 104 46 92 Z" fill="#2E9158" />
      <path d="M44 82 Q32 96 28 108 Q44 100 52 90 Z" fill="#3CB46E" />
      {/* body */}
      <ellipse cx="62" cy="70" rx="30" ry="34" fill="#4CC97E" />
      <ellipse cx="62" cy="78" rx="20" ry="22" fill="#A8E6C1" />
      {/* wing */}
      <g transform={wingFlap ? 'rotate(-40 88 62)' : undefined} style={{ transition: 'transform .2s' }}>
        <ellipse cx="88" cy="70" rx="12" ry="22" fill="#2E9158" />
      </g>
      {/* head */}
      <circle cx="58" cy="34" r="24" fill="#4CC97E" />
      {/* eye */}
      {eyesClosed ? (
        <path d="M60 30 q6 4 12 0" stroke="#26221C" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      ) : (
        <>
          <circle cx="66" cy="30" r="7" fill="white" />
          <circle cx="67.5" cy="31" r="3.6" fill="#26221C" />
          <circle cx="69" cy="29.5" r="1.2" fill="white" />
        </>
      )}
      {/* beak */}
      {openBeak ? (
        <>
          <path d="M78 34 Q94 34 92 42 Q84 46 76 42 Z" fill="#F5A623" />
          <path d="M77 43 Q88 48 84 53 Q77 52 74 46 Z" fill="#D88E0F" />
        </>
      ) : (
        <path d="M78 32 Q96 36 90 46 Q80 50 75 42 Z" fill="#F5A623" />
      )}
      {/* head feather */}
      <path d="M52 12 Q56 2 64 8 Q60 12 60 16 Q56 12 52 12" fill="#FF5C39" />
      {/* outfit (bought in the shop) */}
      <Outfit outfit={worn} />
      {/* feet */}
      <path d="M52 102 l-3 8 M52 102 l3 8 M70 102 l-3 8 M70 102 l3 8" stroke="#D88E0F" strokeWidth="3.5" strokeLinecap="round" />
      {/* celebrate sparkles */}
      {pose === 'celebrate' && (
        <>
          <circle cx="20" cy="24" r="3" fill="#F5A623" />
          <circle cx="102" cy="18" r="2.5" fill="#FF5C39" />
          <circle cx="106" cy="50" r="2" fill="#F5A623" />
          <path d="M16 48 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#FF5C39" />
        </>
      )}
    </svg>
  );
}
