// First-open welcome: Chikki flies in from the distance straight at the
// viewer, the name appears, then the bird swoops past and the app opens.
// Shown once per device (and again after "Start over" in the developer
// version). Tap anywhere to skip. With reduced motion it is a short still.
import { useEffect, useRef, useState } from 'react';
import { Mascot } from '../components/Mascot';

const KEY = 'chilaka.welcomed';
const FLIGHT_MS = 3400;
const STILL_MS = 1400;

function alreadyWelcomed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage blocked: never trap the learner behind an intro
  }
}

export function Welcome() {
  const [phase, setPhase] = useState<'play' | 'leave' | 'gone'>(() => (alreadyWelcomed() ? 'gone' : 'play'));
  const timers = useRef<number[]>([]);

  const finish = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* fine: it will simply show again next time */
    }
    timers.current.forEach((t) => window.clearTimeout(t));
    setPhase('leave');
    timers.current = [window.setTimeout(() => setPhase('gone'), 320)];
  };

  useEffect(() => {
    if (phase !== 'play') return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    timers.current = [window.setTimeout(finish, still ? STILL_MS : FLIGHT_MS)];
    return () => timers.current.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'gone') return null;
  return (
    <div
      className={`welcome ${phase === 'leave' ? 'is-leaving' : ''}`}
      data-testid="welcome"
      role="button"
      tabIndex={0}
      aria-label="Welcome to Chilaka. Tap to continue."
      onClick={finish}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && finish()}
    >
      <div className="welcome-sun" aria-hidden="true" />
      <div className="welcome-cloud welcome-cloud-a" aria-hidden="true" />
      <div className="welcome-cloud welcome-cloud-b" aria-hidden="true" />
      <div className="welcome-cloud welcome-cloud-c" aria-hidden="true" />
      <div className="welcome-bird" aria-hidden="true">
        <div className="welcome-bob">
          <Mascot pose="cheer" size={190} />
        </div>
      </div>
      <div className="welcome-words">
        <p className="welcome-te te-script" lang="te">
          నమస్కారం
        </p>
        <h1 className="welcome-title">Welcome to Chilaka</h1>
        <p className="welcome-sub">Learn Telugu with Chikki</p>
      </div>
      <p className="welcome-skip">Tap to skip</p>
    </div>
  );
}
