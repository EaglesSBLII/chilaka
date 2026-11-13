import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { Button, Card } from '../components/ui';
import { Mascot } from '../components/Mascot';
import type { Difficulty } from '../engine/types';
import { DAILY_GOAL_XP } from '../engine/xp';
import { Auth } from './Auth';

const DIFFICULTIES: { key: Difficulty; title: string; desc: string }[] = [
  { key: 'relaxed', title: 'Relaxed', desc: '~15 min/day' },
  { key: 'standard', title: 'Standard', desc: '~30–45 min/day' },
  { key: 'intense', title: 'Intense', desc: '60+ min/day' },
];

export function Onboarding() {
  // 0 = sign in or create an account; 'auth' = the account form; 1–3 = the
  // questions (name, pace, level), asked only when we do not know the learner yet
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 'auth'>(0);
  const [authMode, setAuthMode] = useState<'signin' | 'create'>('create');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const session = useApp((s) => s.session);
  // signed in already (a sync brought the account before the questions were
  // answered, or the app was closed halfway): go straight to the questions
  useEffect(() => {
    if (session && step === 0) setStep(1);
  }, [session, step]);

  const afterAuth = async (created: boolean) => {
    if (created) return setStep(1);
    // signed in: the account's progress has been merged in. If it already has
    // a name and level there is nothing to ask.
    setBusy(true);
    try {
      await useApp.getState().init();
    } finally {
      setBusy(false);
    }
    if (useApp.getState().profile?.onboarded) navigate({ name: 'path' });
    else setStep(1);
  };
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const createProfile = useApp((s) => s.createProfile);
  const navigate = useApp((s) => s.navigate);
  const skipPlacement = useApp((s) => s.skipPlacement);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-10">
      {step === 0 && (
        <div className="flex flex-col items-center gap-5 text-center animate-pop">
          <Mascot pose="cheer" size={170} />
          <h1 className="text-4xl font-extrabold text-teal">నమస్కారం!</h1>
          <p className="text-lg text-ink-soft font-semibold">
            I'm <span className="text-teal font-extrabold">Chikki</span>. By December, you'll be chatting away in
            Telugu — with your family and half of Hyderabad.
          </p>
          <Button
            className="w-full text-lg"
            onClick={() => {
              setAuthMode('create');
              setStep('auth');
            }}
          >
            Create an account
          </Button>
          <Button
            variant="secondary"
            className="w-full text-lg"
            onClick={() => {
              setAuthMode('signin');
              setStep('auth');
            }}
          >
            I already have an account
          </Button>
          <p className="text-sm font-semibold text-ink-soft">Free. An account keeps your progress on every device.</p>
          <button type="button" className="text-sm font-bold text-ink-soft underline" onClick={() => setStep(1)}>
            Continue without an account
          </button>
        </div>
      )}

      {step === 'auth' && (busy ? <p className="text-center font-bold text-ink-soft">Getting your progress…</p> : <Auth initialMode={authMode} onDone={(created) => void afterAuth(created)} onBack={() => setStep(0)} />)}

      {step === 1 && (
        <div className="flex flex-col gap-5 animate-pop">
          <div className="flex items-end gap-3">
            <Mascot pose="teach" size={80} />
            <h2 className="text-2xl font-extrabold">What should I call you?</h2>
          </div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="rounded-2xl border-2 border-line bg-card px-4 py-3 text-lg font-semibold outline-none focus:border-teal"
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && setStep(2)}
          />
          <Button disabled={!name.trim()} onClick={() => setStep(2)}>
            Continue
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 animate-pop">
          <div className="flex items-end gap-3">
            <Mascot pose="teach" size={80} />
            <h2 className="text-2xl font-extrabold">Pick your pace</h2>
          </div>
          {DIFFICULTIES.map((d) => (
            <Card
              key={d.key}
              className={`cursor-pointer transition-all ${
                difficulty === d.key ? 'border-teal ring-2 ring-teal/30' : 'hover:border-teal/50'
              }`}
            >
              <button className="flex w-full items-center justify-between" onClick={() => setDifficulty(d.key)}>
                <div className="text-left">
                  <div className="text-lg font-extrabold">{d.title}</div>
                  <div className="text-ink-soft font-semibold">{d.desc}</div>
                </div>
                <div className="text-marigold font-extrabold">{DAILY_GOAL_XP[d.key]} XP/day</div>
              </button>
            </Card>
          ))}
          <Button
            onClick={async () => {
              await createProfile(name.trim(), difficulty);
              setStep(3);
            }}
          >
            Continue
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col items-center gap-5 text-center animate-pop">
          <Mascot pose="idle" size={140} />
          <h2 className="text-2xl font-extrabold">You already understand Telugu?</h2>
          <p className="text-ink-soft font-semibold">
            Take a quick 2-minute placement to skip what you already know — or start from the beginning and
            work up lesson by lesson.
          </p>
          <Button className="w-full" onClick={() => navigate({ name: 'placement' })}>
            Find my level
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => void skipPlacement()}>
            Start from the beginning
          </Button>
          {!session && (
            <p className="text-center text-xs font-semibold text-ink-soft">
              Want your progress on every device? Sign in any time in Settings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
