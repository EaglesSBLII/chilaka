// First-open welcome: a moving poster in the flyer colours. The striped band
// runs across the top, the flame sun and its marigold ring pop in, a giant
// Telugu word slides in behind, Chikki flies in and lands, and the headline
// rises word by word. On the way out the sun swells over the screen and clears
// to the app. Shown once per device (and again after "Start over" in the
// developer version). Tap anywhere to skip. With reduced motion it is a still.
import { useEffect, useRef, useState } from 'react';
import { Mascot } from '../components/Mascot';

const KEY = 'chilaka.welcomed';
const SHOW_MS = 3300;
const STILL_MS = 1600;
const LEAVE_MS = 820;

function alreadyWelcomed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage blocked: never trap the learner behind an intro
  }
}

export function Welcome() {
  const [phase, setPhase] = useState<'play' | 'leave' | 'gone'>(() => (alreadyWelcomed() ? 'gone' : 'play'));
  const timer = useRef(0);
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const finish = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* fine: it will simply show again next time */
    }
    window.clearTimeout(timer.current);
    setPhase('leave');
    timer.current = window.setTimeout(() => setPhase('gone'), still ? 220 : LEAVE_MS);
  };

  useEffect(() => {
    if (phase !== 'play') return;
    // tests can hold the welcome open to photograph single frames
    if ((window as unknown as { __welcomeHold?: boolean }).__welcomeHold) return;
    timer.current = window.setTimeout(finish, still ? STILL_MS : SHOW_MS);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (phase === 'gone') return null;
  return (
    <div
      className={`welcome ${phase === 'leave' ? 'is-leaving' : ''}`}
      data-testid="welcome"
      role="button"
      tabIndex={0}
      aria-label="Welcome to Chilaka. Tap to continue."
      onClick={() => phase === 'play' && finish()}
      onKeyDown={(e) => phase === 'play' && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && finish()}
    >
      <div className="welcome-sun" aria-hidden="true" />
      <div className="welcome-ring" aria-hidden="true" />
      <p className="welcome-giant te-script" lang="te" aria-hidden="true">
        తెలుగు
      </p>
      <div className="welcome-stripe" aria-hidden="true" />
      <p className="welcome-brand" aria-hidden="true">
        Chilaka{' '}
        <span className="te-script" lang="te">
          చిలక
        </span>
      </p>
      <div className="welcome-bird" aria-hidden="true">
        <div className="welcome-bob">
          <Mascot pose="cheer" size={200} outfit={null} />
        </div>
      </div>
      <div className="welcome-words">
        <h1 className="welcome-title">
          <span>Welcome</span> <span>to</span> <span>Chilaka.</span>
        </h1>
        <p className="welcome-sub">Speak, read and write Telugu with Chikki.</p>
        <div className="welcome-chips" aria-hidden="true">
          <span>iPhone</span>
          <span>Mac</span>
          <span>Free</span>
        </div>
      </div>
      <p className="welcome-skip">Tap to skip</p>
      <div className="welcome-wipe" aria-hidden="true" />
    </div>
  );
}
