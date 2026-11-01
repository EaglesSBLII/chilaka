// Chikki the parrot (చిలక) — the app mascot. Pure SVG, five poses.

export type MascotPose = 'idle' | 'cheer' | 'teach' | 'sleepy' | 'celebrate';

export function Mascot({ pose = 'idle', size = 120 }: { pose?: MascotPose; size?: number }) {
  const wingFlap = pose === 'cheer' || pose === 'celebrate';
  const eyesClosed = pose === 'sleepy';
  const openBeak = pose === 'teach' || pose === 'celebrate';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
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
