// Account screen: create, sign in, or reset the password with your birthday
// (accounts made before birthdays use their recovery code).
import { useState } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, LogIn, UserPlus } from 'lucide-react';
import { useApp } from '../store';
import { Button, Card } from '../components/ui';
import { Mascot } from '../components/Mascot';
import { AuthError, login, reset, signup, validBirthday, validEmail } from '../auth';

type Mode = 'signin' | 'create' | 'recover';

function Field({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoCapitalize="none"
        spellCheck={false}
        className="w-full rounded-2xl border border-line bg-card px-4 py-3 font-semibold text-ink shadow-press outline-none focus:border-accent"
      />
    </label>
  );
}

function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* clipboard blocked: the code is on screen */
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="surface-hero p-5 text-center">
        <KeyRound className="mx-auto text-accent-dark" size={32} />
        <h2 className="mt-2 text-xl font-extrabold">Save your recovery code</h2>
        <p className="mt-1 text-sm font-semibold text-ink-soft">
          Chilaka never sends email. If you forget your password, this code is the only way back in. Keep it somewhere safe.
        </p>
        <div className="mt-4 select-all rounded-2xl bg-card px-3 py-3 font-mono text-lg font-extrabold tracking-wider shadow-press" data-testid="recovery-code">
          {code}
        </div>
        <Button variant="ghost" className="mt-3 w-full" onClick={copy}>
          <span className="inline-flex items-center gap-2">
            {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'Copied' : 'Copy code'}
          </span>
        </Button>
      </div>
      <label className="flex items-center gap-3 rounded-2xl bg-card/70 px-4 py-3 font-semibold shadow-press">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-5 w-5 accent-[var(--c-accent)]" />I saved this code
      </label>
      <Button className="w-full text-lg" disabled={!saved} onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

export function Auth({ initialMode = 'signin' }: { initialMode?: Mode }) {
  const navigate = useApp((s) => s.navigate);
  const setSession = useApp((s) => s.setSession);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [birthday, setBirthday] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (__CHANNEL__ === 'dev') {
      // the developer preview may hold half-finished features and test progress:
      // keep it away from real accounts so nothing unreleased merges into them
      return setError('Accounts are switched off in the developer version, so test progress never mixes into a real account.');
    }
    if (!validEmail(email)) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    const byCode = mode === 'recover' && useCode;
    if (byCode && code.trim().length < 20) return setError('Enter the full recovery code.');
    if (mode !== 'signin' && !byCode && !validBirthday(birthday)) return setError('Enter your full date of birth.');
    setBusy(true);
    try {
      if (mode === 'create') {
        const r = await signup(email, password, birthday);
        setSession(r.session);
        navigate({ name: 'settings' });
      } else if (mode === 'signin') {
        setSession(await login(email, password));
        navigate({ name: 'settings' });
      } else {
        const r = await reset(email, byCode ? { recoveryCode: code } : { birthday }, password);
        setSession(r.session);
        // only an older account gets a new one-time code to save
        if (r.recoveryCode) setRecovery(r.recoveryCode);
        else navigate({ name: 'settings' });
      }
    } catch (e) {
      console.error('auth failed', e);
      setError(e instanceof AuthError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (recovery) {
    return (
      <div className="mx-auto max-w-md">
        <RecoveryCode code={recovery} onDone={() => navigate({ name: 'settings' })} />
      </div>
    );
  }

  const title = mode === 'create' ? 'Create your account' : mode === 'signin' ? 'Welcome back' : 'Recover your account';
  const Icon = mode === 'create' ? UserPlus : mode === 'signin' ? LogIn : KeyRound;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <button type="button" onClick={() => navigate({ name: 'settings' })} className="inline-flex items-center gap-1 self-start font-bold text-ink-soft" aria-label="Back">
        <ArrowLeft size={18} /> Back
      </button>
      <div className="surface-hero flex items-center gap-4 p-5">
        <Mascot pose="teach" size={76} />
        <div>
          <h1 className="text-2xl font-extrabold">{title}</h1>
          <p className="text-sm font-semibold text-ink-soft">
            {mode === 'create'
              ? 'Keep your progress on every device. Free, no ads, no email spam.'
              : mode === 'signin'
                ? 'Your lessons, streak and coins come with you.'
                : useCode
                  ? 'Use the recovery code you saved when you signed up.'
                  : 'Enter the birthday you gave when you signed up, then choose a new password.'}
          </p>
        </div>
      </div>
      <Card className="flex flex-col gap-3">
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com" />
        {mode === 'recover' && useCode && <Field label="Recovery code" value={code} onChange={setCode} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" />}
        {(mode === 'create' || (mode === 'recover' && !useCode)) && (
          <>
            <Field label="Birthday" type="date" value={birthday} onChange={setBirthday} autoComplete="bday" />
            {mode === 'create' && (
              <p className="-mt-1 text-xs font-semibold text-ink-soft">
                If you forget your password, your birthday is how you reset it. Chilaka never sends email.
              </p>
            )}
          </>
        )}
        {mode === 'recover' && (
          <button type="button" className="self-start text-xs font-bold text-teal" onClick={() => setUseCode(!useCode)}>
            {useCode ? 'Use my birthday instead' : 'Signed up before birthdays? Use your recovery code'}
          </button>
        )}
        <Field
          label={mode === 'recover' ? 'New password' : 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          placeholder="at least 8 characters"
        />
        {error && (
          <p className="rounded-xl bg-error-soft px-3 py-2 text-sm font-bold text-error-dark" role="alert">
            {error}
          </p>
        )}
        <Button className="mt-1 w-full text-lg" disabled={busy} onClick={() => void submit()}>
          <span className="inline-flex items-center gap-2">
            <Icon size={20} /> {busy ? 'One moment…' : mode === 'create' ? 'Create account' : mode === 'signin' ? 'Sign in' : 'Reset password'}
          </span>
        </Button>
        {busy && <p className="text-center text-xs font-semibold text-ink-soft">Securing your password on this device…</p>}
      </Card>
      <div className="flex flex-col items-center gap-2 text-sm font-bold text-ink-soft">
        {mode !== 'signin' && (
          <button type="button" className="text-teal" onClick={() => setMode('signin')}>
            Already have an account? Sign in
          </button>
        )}
        {mode !== 'create' && (
          <button type="button" className="text-teal" onClick={() => setMode('create')}>
            New here? Create an account
          </button>
        )}
        {mode !== 'recover' && (
          <button type="button" onClick={() => setMode('recover')}>
            Forgot your password? Reset it with your birthday
          </button>
        )}
      </div>
    </div>
  );
}
