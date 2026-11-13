// Opening screen, played every time the app is opened: a moving poster in the
// flyer colours. The striped band runs across the top, the flame sun and its
// marigold ring pop in, a giant Telugu word slides in behind, Chikki flies in
// and lands, and the name "Chilaka." rises. On the way out the sun swells over
// the screen and clears to the app. A tap anywhere skips it. With reduced
// motion it is a short still.
import { useEffect, useRef, useState } from 'react';
import { Mascot } from '../components/Mascot';

const SHOW_MS = 2300;
const STILL_MS = 1100;
const LEAVE_MS = 820;

/**
 * Automated browsers (the test suites) skip it, or every test would wait for
 * it on every page load. The spec that tests the opening screen itself sets
 * the preview flag.
 */
function skipped(): boolean {
  try {
    return navigator.webdriver === true && localStorage.getItem('chilaka.welcomePreview') !== '1';
  } catch {
    return false;
  }
}

export function Welcome() {
  const [phase, setPhase] = useState<'play' | 'leave' | 'gone'>(() => (skipped() ? 'gone' : 'play'));
  const timer = useRef(0);
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const finish = () => {
    window.clearTimeout(timer.current);
    setPhase('leave');
    timer.current = window.setTimeout(() => setPhase('gone'), still ? 220 : LEAVE_MS);
  };

  useEffect(() => {
    if (phase !== 'play') return;
    // tests can hold it open to photograph single frames
    if ((window as unknown as { __welcomeHold?: boolean }).__welcomeHold) return;
    const mine = window.setTimeout(finish, still ? STILL_MS : SHOW_MS);
    timer.current = mine;
    return () => window.clearTimeout(mine); // only this timer: finish() starts the leave timer in the same breath
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (phase === 'gone') return null;
  return (
    <div
      className={`welcome ${phase === 'leave' ? 'is-leaving' : ''}`}
      data-testid="welcome"
      role="button"
      tabIndex={0}
      aria-label="Chilaka. Tap to continue."
      onClick={() => phase === 'play' && finish()}
      onKeyDown={(e) => phase === 'play' && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && finish()}
    >
      <div className="welcome-sun" aria-hidden="true" />
      <div className="welcome-ring" aria-hidden="true" />
      <p className="welcome-giant te-script" lang="te" aria-hidden="true">
        తెలుగు
      </p>
      <div className="welcome-stripe" aria-hidden="true" />
      <div className="welcome-bird" aria-hidden="true">
        <div className="welcome-bob">
          <Mascot pose="cheer" size={200} outfit={null} />
        </div>
      </div>
      <div className="welcome-words">
        <h1 className="welcome-title">
          <span>Chilaka.</span>
        </h1>
      </div>
      <div className="welcome-wipe" aria-hidden="true" />
    </div>
  );
}
