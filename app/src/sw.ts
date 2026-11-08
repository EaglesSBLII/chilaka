/// <reference lib="webworker" />
// Service worker: precache the app (+ the default voice), cache the male
// voice on demand, and show push reminders. Built by vite-plugin-pwa
// (injectManifest), so the precache list is injected at build time.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

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
