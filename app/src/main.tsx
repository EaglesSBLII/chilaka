import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

// PWA service worker (no-ops under file:// in Electron)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      /* dev mode without PWA — fine */
    });
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
