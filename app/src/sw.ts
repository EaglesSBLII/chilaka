/// <reference lib="webworker" />
// Service worker: precache the app (+ the default voice), cache the male
// voice on demand, and show push reminders. Built by vite-plugin-pwa
// (injectManifest), so the precache list is injected at build time.
import { cleanupOutdatedCaches, PrecacheController, PrecacheRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// Updates are manual: the new worker waits until the learner presses Restart in
// the app's update banner (vite-plugin-pwa posts SKIP_WAITING for that).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// Precache with live progress: while a new version installs, every finished
// entry (fetched or already cached) is counted and posted to the open pages so
// the update banner can show a real percentage.
let precacheTotal = 0;
let precacheDone = 0;
let lastPost = 0;
async function postProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastPost < 200) return;
  lastPost = now;
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage({ type: 'chilaka-precache-progress', done: precacheDone, total: precacheTotal });
}
const precache = new PrecacheController({
  plugins: [
    {
      handlerDidComplete: async () => {
        precacheDone += 1;
        await postProgress(precacheDone === precacheTotal);
      },
    },
  ],
});
precache.addToCacheList(self.__WB_MANIFEST);
self.addEventListener('install', (event) => {
  precacheTotal = precache.getURLsToCacheKeys().size;
  precacheDone = 0;
  event.waitUntil(postProgress(true).then(() => precache.install(event)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(precache.activate(event).then(() => self.clients.claim()));
});
cleanupOutdatedCaches();
registerRoute(new PrecacheRoute(precache));

// the male voice is not precached (size); it is kept once heard
registerRoute(
  ({ url }) => url.pathname.includes('/audio/v-male/'),
  new CacheFirst({
    cacheName: 'voice-male',
    plugins: [new ExpirationPlugin({ maxEntries: 1400, purgeOnQuotaError: true })],
  }),
);

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() as PushPayload) ?? {};
  } catch {
    payload = { body: event.data?.text() ?? undefined };
  }
  const title = payload.title ?? 'Time for Telugu';
  const options: NotificationOptions = {
    body: payload.body ?? 'A short lesson keeps your streak alive.',
    tag: payload.tag ?? 'chilaka-reminder',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: payload.url ?? './' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string })?.url ?? './', self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});
