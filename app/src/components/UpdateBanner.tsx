// Visible update lifecycle for the installed app: when a new version starts
// downloading, show a banner with an animated bar; when it takes control,
// restart automatically so the user is never silently stuck on an old build.

import { useEffect, useState } from 'react';

type Phase = 'idle' | 'downloading' | 'restarting';

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    // only surface UPGRADES — a first-time install has no controller yet and
    // should stay silent (it's the normal install, not an update)
    if (!navigator.serviceWorker.controller) return;
    let disposed = false;

    const watchInstalling = (sw: ServiceWorker) => {
      setPhase('downloading');
      sw.addEventListener('statechange', () => {
        if (disposed) return;
        if (sw.state === 'installed' || sw.state === 'activated') {
          setPhase('restarting');
        }
      });
    };

    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || disposed) return;
      if (reg.installing) watchInstalling(reg.installing);
      reg.addEventListener('updatefound', () => {
        if (reg.installing) watchInstalling(reg.installing);
      });
    });

    // the new worker took over → load the new version (guard against loops)
    const onControllerChange = () => {
      if (sessionStorage.getItem('chilaka-just-updated') === '1') return;
      sessionStorage.setItem('chilaka-just-updated', '1');
      setPhase('restarting');
      setTimeout(() => window.location.reload(), 600);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  useEffect(() => {
    // clear the loop-guard once the fresh session is running
    sessionStorage.removeItem('chilaka-just-updated');
  }, []);

  if (phase === 'idle') return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-teal px-4 py-2 text-white shadow-lg">
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <span className="text-lg">{phase === 'downloading' ? '⬇️' : '✨'}</span>
        <div className="flex-1">
          <div className="text-sm font-extrabold">
            {phase === 'downloading' ? 'Downloading update…' : 'Update ready — restarting'}
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/25">
            <div
              className={phase === 'downloading' ? 'update-bar-indeterminate h-full w-1/3 rounded-full bg-white' : 'h-full w-full rounded-full bg-white'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
