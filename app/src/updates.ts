// One update state for both hosts, shown by components/UpdateBanner.
//
// Web / iPhone (PWA): the browser downloads a new version in the background as
// soon as it is published; the service worker reports precache progress, and
// the learner presses Restart to switch to it (no silent reloads mid-lesson).
// Mac app: the self-updater (desktop/src/updater.js) reports a new release;
// the learner presses Update to download it (live percentage), then Restart.

import { create } from 'zustand';
import type { DesktopUpdateState } from './platform/types';

export type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdateState {
  host: 'web' | 'desktop';
  phase: UpdatePhase;
  /** new version, when the host knows it (the Mac app does; the PWA does not) */
  version?: string;
  /** 0–100 while downloading */
  percent: number;
  /** bytes, Mac app only */
  received?: number;
  size?: number;
  error?: string;
  /** Mac app: start the download. Web: no-op (the browser already downloads). */
  update: () => void;
  /** switch to the downloaded version (restarts / reloads) */
  restart: () => void;
  /** Mac app: look for a new release now */
  check: () => void;
}

const isDesktop = () => Boolean(window.chilakaBridge?.updater);

export const useUpdates = create<UpdateState>(() => ({
  host: isDesktop() ? 'desktop' : 'web',
  phase: 'idle',
  percent: 0,
  update: () => {},
  restart: () => {},
  check: () => {},
}));

const set = useUpdates.setState;

function fromDesktop(s: DesktopUpdateState) {
  set({
    phase: s.phase,
    version: s.version,
    percent: s.percent ?? 0,
    received: s.received,
    size: s.size,
    error: s.error,
  });
}

export function startUpdateWatch() {
  const bridge = window.chilakaBridge?.updater;
  if (bridge) {
    set({
      host: 'desktop',
      update: () => void bridge.download(),
      restart: () => void bridge.install(),
      check: () => void bridge.check(),
    });
    bridge.onState(fromDesktop);
    void bridge.state().then(fromDesktop);
    return;
  }
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // a first install has no controller: that is the normal install, not an update
  const isUpgrade = () => Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; done?: number; total?: number } | undefined;
    if (d?.type !== 'chilaka-precache-progress' || !isUpgrade()) return;
    const total = d.total || 0;
    const pct = total ? Math.min(99, Math.floor(((d.done || 0) / total) * 100)) : 0;
    if (useUpdates.getState().phase !== 'ready') set({ phase: 'downloading', percent: pct });
  });
  let registration: ServiceWorkerRegistration | undefined;
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          set({ phase: 'ready', percent: 100 });
        },
        onRegisteredSW(_url, reg) {
          if (!reg) return;
          registration = reg;
          const watch = (sw: ServiceWorker | null) => {
            if (!sw || !isUpgrade()) return;
            set({ phase: 'downloading', percent: 0 });
            sw.addEventListener('statechange', () => {
              if (sw.state === 'redundant' && useUpdates.getState().phase === 'downloading') {
                set({ phase: 'error', error: 'The update could not be installed. It will be retried later.' });
              }
            });
          };
          watch(reg.installing);
          reg.addEventListener('updatefound', () => watch(reg.installing));
          // look for a new version every hour while the app stays open, and when it comes back to the front
          setInterval(() => void reg.update(), 60 * 60 * 1000);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void reg.update();
          });
          set({ check: () => void reg.update() });
        },
        onRegisterError() {
          /* offline or dev mode without a worker — fine */
        },
      });
      // Switch-over is done here, not by the plugin: it only reloads for a
      // worker it saw install within a minute of registration, and our checks
      // (hourly, on return to the app) find updates long after that.
      set({
        restart: () => {
          const waiting = registration?.waiting;
          if (!waiting) return location.reload();
          let done = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (done) return;
            done = true;
            location.reload();
          });
          waiting.postMessage({ type: 'SKIP_WAITING' });
          // if the new worker never takes control (should not happen), do not leave the learner stuck
          setTimeout(() => {
            if (!done) {
              done = true;
              location.reload();
            }
          }, 8000);
        },
      });
    })
    .catch(() => {
      /* dev mode without PWA — fine */
    });
}
