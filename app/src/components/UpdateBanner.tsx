// Update notice at the top of the home screen. Nothing happens on its own:
// the learner presses Update (Mac app) and Restart (both hosts). While the new
// version downloads, the bar shows the real percentage.

import { useUpdates } from '../updates';

const mb = (n?: number) => (n ? `${(n / 1048576).toFixed(n > 100 * 1048576 ? 0 : 1)} MB` : '');

export function UpdateBanner() {
  const { host, phase, version, percent, received, size, error, update, restart } = useUpdates();
  if (phase === 'idle' || phase === 'checking' || phase === 'up-to-date') return null;

  const name = version ? `Chilaka ${version}` : 'A new version of Chilaka';
  const button = 'shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-extrabold text-teal shadow-sm active:scale-95';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-banner"
      data-phase={phase}
      className="bg-teal px-4 pb-2.5 text-white shadow-lg pt-[calc(env(safe-area-inset-top)+0.625rem)]"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <span className="text-lg" aria-hidden>
          {phase === 'error' ? '⚠️' : phase === 'ready' ? '✨' : '⬇️'}
        </span>
        <div className="min-w-0 flex-1">
          {phase === 'available' && (
            <>
              <div className="text-sm font-extrabold">{name} is available</div>
              <div className="text-xs text-white/80">{size ? `${mb(size)} download · ` : ''}Press Update when you are ready.</div>
            </>
          )}
          {phase === 'downloading' && (
            <>
              <div className="flex items-baseline justify-between gap-2 text-sm font-extrabold">
                <span className="truncate">Downloading {version ? `Chilaka ${version}` : 'the update'}…</span>
                <span className="tabular-nums" data-testid="update-percent">
                  {percent}%
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/25">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(2, percent)}%` }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                />
              </div>
              {size ? (
                <div className="mt-0.5 text-[11px] tabular-nums text-white/80">
                  {mb(received)} of {mb(size)}
                </div>
              ) : null}
            </>
          )}
          {phase === 'ready' && (
            <>
              <div className="text-sm font-extrabold">{name} is ready</div>
              <div className="text-xs text-white/80">
                {host === 'desktop' ? 'Restart to finish updating. Your progress is kept.' : 'Restart to switch to it. Your progress is kept.'}
              </div>
            </>
          )}
          {phase === 'error' && (
            <>
              <div className="text-sm font-extrabold">Update problem</div>
              <div className="truncate text-xs text-white/80">{error}</div>
            </>
          )}
        </div>
        {phase === 'available' && (
          <button className={button} onClick={update}>
            Update
          </button>
        )}
        {phase === 'ready' && (
          <button className={button} onClick={restart}>
            Restart
          </button>
        )}
        {phase === 'error' && host === 'desktop' && (
          <button className={button} onClick={update}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
