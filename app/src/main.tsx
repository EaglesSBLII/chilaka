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
if (import.meta.env.PROD && location.protocol.startsWith('http') && location.hostname !== 'localhost') {
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
testWindow.__glossForRoman = (roman) =>
  allItems().find((i) => i.roman === roman)?.gloss ?? null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
