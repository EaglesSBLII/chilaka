// Web push reminder toggle (iPhone home-screen app / browsers). Lives inside
// the Daily reminders card; the Mac app uses native notifications instead.
import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useApp } from '../../store';
import { Button } from '../../components/ui';
import { disablePush, enablePush, pushEnabled, pushNeedsInstall, pushSupported } from '../../push';

export function PushToggle({ hh, mm, flash }: { hh: number; mm: number; flash: (msg: string) => void }) {
  const session = useApp((s) => s.session);
  const navigate = useApp((s) => s.navigate);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  useEffect(() => {
    void pushEnabled().then(setOn);
  }, []);

  // keep the server schedule in step with the saved time
  useEffect(() => {
    if (!on || !session) return;
    void enablePush(hh, mm).catch(() => {});
  }, [hh, mm, on, session]);

  if (pushNeedsInstall()) {
    return (
      <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold">
        To get reminders on iPhone, add Chilaka to your Home Screen first (Share → Add to Home Screen), then come back here.
      </p>
    );
  }
  if (!supported) return null;

  const toggle = async () => {
    if (!session) {
      navigate({ name: 'auth', mode: 'signin' });
      return;
    }
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
        flash('Reminders off.');
      } else {
        await enablePush(hh, mm);
        setOn(true);
        flash('Reminders on! We will nudge you on days you have not practised.');
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not change reminders.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-card/70 px-3 py-2 shadow-press" data-testid="push-toggle">
      <BellRing size={20} className={on ? 'text-accent-dark' : 'text-ink-soft'} />
      <div className="flex-1 text-sm font-semibold">
        <div className="font-extrabold">Push reminders on this device</div>
        <div className="text-ink-soft">{session ? `At ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} on days you have not practised.` : 'Needs an account so the reminder can find you.'}</div>
      </div>
      <Button variant={on ? 'ghost' : 'primary'} className="px-3 py-2 text-sm" disabled={busy} onClick={() => void toggle()}>
        {session ? (on ? 'Turn off' : 'Turn on') : 'Sign in'}
      </Button>
    </div>
  );
}
