// Settings → Account: signed-out call to action, or the signed-in summary.
import { useState } from 'react';
import { CloudCheck, LogOut, UserRound } from 'lucide-react';
import { useApp } from '../../store';
import { Button, Card } from '../../components/ui';
import { logout } from '../../auth';

export function AccountCard() {
  const session = useApp((s) => s.session);
  const setSession = useApp((s) => s.setSession);
  const navigate = useApp((s) => s.navigate);
  const [busy, setBusy] = useState(false);

  const signOut = async (forget: boolean) => {
    setBusy(true);
    try {
      await logout(forget);
      setSession(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="account-card">
      <h3 className="mb-1 flex items-center gap-2 font-extrabold">
        <UserRound size={18} /> Account
      </h3>
      {session ? (
        <>
          <p className="text-sm font-semibold text-ink-soft">
            Signed in as <span className="font-extrabold text-ink">{session.email}</span>. Your progress syncs to every device you sign in on.
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-success-dark">
            <CloudCheck size={14} /> Progress backed up
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" className="px-4 py-2 text-sm" disabled={busy} onClick={() => void signOut(false)}>
              <span className="inline-flex items-center gap-1">
                <LogOut size={16} /> Sign out
              </span>
            </Button>
            <Button variant="ghost" className="px-4 py-2 text-sm" disabled={busy} onClick={() => void signOut(true)} title="Sign out and stop syncing this device to the account">
              Sign out &amp; forget this device
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-ink-soft">
            Sign in to keep your streak, coins and lessons on your Mac, iPhone and anywhere else you use Chilaka. New here? A free account takes a minute.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="px-4 py-2 text-sm" onClick={() => navigate({ name: 'auth', mode: 'signin' })}>
              Sign in
            </Button>
            <Button variant="ghost" className="px-4 py-2 text-sm" onClick={() => navigate({ name: 'auth', mode: 'create' })}>
              Create account
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
