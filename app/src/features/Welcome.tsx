// First-open welcome: Chikki flies in from the distance, hovers while the name
// appears, then dives head-first into the camera and the app opens.
// The flight is real 3D (features/welcome/Flight3D.tsx, loaded only here). If
// the device cannot do 3D, or the 3D code does not arrive in time, a flat
// version of the same flight plays instead; with reduced motion it is a still.
// Shown once per device (and again after "Start over" in the developer
// version). Tap anywhere to skip.
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Mascot } from '../components/Mascot';
import { FLIGHT_MS } from './welcome/timing';

const Flight3D = lazy(() => import('./welcome/Flight3D'));

const KEY = 'chilaka.welcomed';
const FLAT_MS = 3400;
const STILL_MS = 1400;
const WAIT_FOR_3D_MS = 4500;

function alreadyWelcomed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage blocked: never trap the learner behind an intro
  }
}

class Catch extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error("welcome 3d failed", e);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Mode = 'loading' | '3d' | 'flat' | 'still';

export function Welcome() {
  const [phase, setPhase] = useState<'play' | 'leave' | 'gone'>(() => (alreadyWelcomed() ? 'gone' : 'play'));
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'still' : 'loading',
  );
  const timer = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const finish = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* fine: it will simply show again next time */
    }
    window.clearTimeout(timer.current);
    setPhase('leave');
    timer.current = window.setTimeout(() => setPhase('gone'), 380);
  };
  const endIn = (ms: number) => {
    window.clearTimeout(timer.current);
    // tests can hold the welcome open to photograph single frames
    if ((window as unknown as { __welcomeHold?: boolean }).__welcomeHold) return;
    timer.current = window.setTimeout(finish, ms);
  };
  const fallBack = () => {
    if (modeRef.current === 'loading' || modeRef.current === '3d') setMode('flat');
  };

  // the clock for each version starts when that version is actually on screen
  useEffect(() => {
    if (phase !== 'play') return;
    if (mode === 'still') endIn(STILL_MS);
    else if (mode === 'flat') endIn(FLAT_MS);
    else if (mode === '3d') endIn(FLIGHT_MS);
    else endIn(WAIT_FOR_3D_MS + FLAT_MS + 500); // never stuck, whatever happens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase]);
  useEffect(() => {
    if (phase !== 'play' || mode !== 'loading') return;
    const t = window.setTimeout(fallBack, WAIT_FOR_3D_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (phase === 'gone') return null;
  const threeD = mode === 'loading' || mode === '3d';
  return (
    <div
      className={`welcome welcome-${mode} ${phase === 'leave' ? 'is-leaving' : ''}`}
      data-testid="welcome"
      data-mode={mode}
      role="button"
      tabIndex={0}
      aria-label="Welcome to Chilaka. Tap to continue."
      onClick={finish}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && finish()}
    >
      <div className="welcome-sun" aria-hidden="true" />
      {threeD ? (
        <Catch onError={fallBack}>
          <Suspense fallback={null}>
            <Flight3D onReady={() => modeRef.current === 'loading' && setMode('3d')} onFail={fallBack} />
          </Suspense>
        </Catch>
      ) : (
        <>
          <div className="welcome-cloud welcome-cloud-a" aria-hidden="true" />
          <div className="welcome-cloud welcome-cloud-b" aria-hidden="true" />
          <div className="welcome-cloud welcome-cloud-c" aria-hidden="true" />
          <div className="welcome-bird" aria-hidden="true">
            <div className="welcome-bob">
              <Mascot pose="cheer" size={190} />
            </div>
          </div>
        </>
      )}
      <div className="welcome-words">
        <p className="welcome-te te-script" lang="te">
          నమస్కారం
        </p>
        <h1 className="welcome-title">Welcome to Chilaka</h1>
        <p className="welcome-sub">Learn Telugu with Chikki</p>
      </div>
      {mode === '3d' && <div className="welcome-impact" aria-hidden="true" />}
      <p className="welcome-skip">Tap to skip</p>
    </div>
  );
}
