// Settings → App update: where a new version is downloaded and switched to.
// The banner at the top of the home screen points here when one is available.
import { Download, RefreshCw, Sparkles } from 'lucide-react';
import { useUpdates } from '../../updates';
import { Button, Card } from '../../components/ui';

const mb = (n?: number) => (n ? `${(n / 1048576).toFixed(n > 100 * 1048576 ? 0 : 1)} MB` : '');

export function UpdateCard() {
  const { host, phase, version, percent, received, size, error, update, restart, check } = useUpdates();
  const name = version ? `Chilaka ${version}` : 'A new version of Chilaka';
  return (
    <Card data-testid="update-card" data-phase={phase}>
      <h3 className="mb-1 flex items-center gap-2 font-extrabold">
        <Download size={18} /> App update
      </h3>
      {(phase === 'idle' || phase === 'up-to-date' || phase === 'checking') && (
        <>
          <p className="text-sm font-semibold text-ink-soft">
            {phase === 'checking' ? 'Checking for a new version…' : 'You have the newest version. When a new one comes out, a banner appears at the top of the home screen.'}
          </p>
          {host === 'desktop' && (
            <Button variant="ghost" className="mt-3 px-4 py-2 text-sm" disabled={phase === 'checking'} onClick={check}>
              <span className="inline-flex items-center gap-1">
                <RefreshCw size={16} /> Check for updates
              </span>
            </Button>
          )}
        </>
      )}
      {phase === 'available' && (
        <>
          <p className="text-sm font-semibold text-ink-soft">
            <span className="font-extrabold text-ink">{name} is available.</span> {size ? `${mb(size)} download. ` : ''}Your progress is kept.
          </p>
          <Button className="mt-3 px-4 py-2 text-sm" onClick={update}>
            <span className="inline-flex items-center gap-1">
              <Download size={16} /> Download update
            </span>
          </Button>
        </>
      )}
      {phase === 'downloading' && (
        <>
          <div className="flex items-baseline justify-between gap-2 text-sm font-extrabold">
            <span>Downloading {version ? `Chilaka ${version}` : 'the update'}…</span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-teal transition-[width] duration-200 ease-out" style={{ width: `${Math.max(2, percent)}%` }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} />
          </div>
          {size ? <p className="mt-1 text-xs font-semibold tabular-nums text-ink-soft">{mb(received)} of {mb(size)}</p> : null}
        </>
      )}
      {phase === 'ready' && (
        <>
          <p className="text-sm font-semibold text-ink-soft">
            <span className="font-extrabold text-ink">{name} is ready.</span> Restart to switch to it. Your progress is kept.
          </p>
          <Button className="mt-3 px-4 py-2 text-sm" onClick={restart}>
            <span className="inline-flex items-center gap-1">
              <Sparkles size={16} /> Restart now
            </span>
          </Button>
        </>
      )}
      {phase === 'error' && (
        <>
          <p className="text-sm font-bold text-error-dark" role="alert">
            Update problem: {error}
          </p>
          {host === 'desktop' && (
            <Button variant="ghost" className="mt-3 px-4 py-2 text-sm" onClick={update}>
              Try again
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
