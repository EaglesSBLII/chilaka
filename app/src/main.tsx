import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

// Updates: PWA service worker on the web (no-ops under file:// in Electron),
// the Mac self-updater on desktop. Both feed the banner at the top of the home screen.
import { startUpdateWatch } from './updates';
startUpdateWatch();

// Visit log: one beacon per app start so the owner can see how many people open the app
// (the PWA shell is served from cache, so the server would otherwise never see repeat opens).
// Only on the hosted build — not in dev, tests, or the Electron file:// build.
if (import.meta.env.PROD && __CHANNEL__ === 'release' && location.protocol.startsWith('http') && location.hostname !== 'localhost') {
  try {
    const payload = JSON.stringify({ standalone: matchMedia('(display-mode: standalone)').matches });
    if (!navigator.sendBeacon?.('/api/visit', new Blob([payload], { type: 'application/json' }))) {
      fetch('/api/visit', { method: 'POST', body: payload, keepalive: true }).catch(() => {});
    }
  } catch {
    /* logging must never affect the app */
  }
}

// Test hooks: let E2E derive the same romanization/answers the UI renders.
import { romanize, allItems } from './content/load';
const testWindow = window as unknown as {
  __roman: (te: string) => string;
  __glossForRoman: (roman: string) => string | null;
};
testWindow.__roman = (te) => romanize(te);
// Tracing: the scorer and the real-font letter masks, so E2E can check real letters.
import { layoutTrace } from './features/exercises/TraceEx';
import { aksharaCount, centreStrokes, isTraceable, scoreTrace } from './engine/trace';
(window as unknown as { __traceLab: unknown }).__traceLab = { layoutTrace, centreStrokes, scoreTrace, isTraceable, aksharaCount };
testWindow.__glossForRoman = (roman) =>
  allItems().find((i) => i.roman === roman)?.gloss ?? null;

// The owner's preview build wears a small tag, so it is never mistaken for the released app.
if (__CHANNEL__ === 'dev') {
  const tag = document.createElement('div');
  tag.textContent = 'DEV';
  tag.setAttribute('aria-hidden', 'true');
  tag.style.cssText =
    'position:fixed;left:50%;top:max(4px,env(safe-area-inset-top));transform:translateX(-50%);z-index:9999;pointer-events:none;' +
    'font:800 10px/1 system-ui,sans-serif;letter-spacing:.12em;color:#fff;background:#c23752;padding:3px 8px;border-radius:999px;opacity:.85';
  document.body.appendChild(tag);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
