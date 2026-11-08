// Web push reminders (iPhone home-screen app, desktop browsers). Needs an
// account: subscriptions are stored per user on the Worker, which sends a
// habit-framed nudge at the chosen time on days with no activity.
import { db } from './db/schema';
import { getSession } from './auth';
import { SYNC_ENDPOINT } from './sync-config';

const ENDPOINT_KEY = 'syncPushEndpoint';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Push works in browsers with the Push API; on iOS only once installed to the home screen. */
export function pushSupported(): boolean {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
  if (window.chilakaBridge) return false; // the Mac app has native reminders
  return !isIOS() || isStandalone();
}

export function pushNeedsInstall(): boolean {
  return isIOS() && !isStandalone();
}

function b64ToBytes(b64: string): ArrayBuffer {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export async function pushEnabled(): Promise<boolean> {
  const row = await db.settings.get(ENDPOINT_KEY);
  return Boolean(row?.value);
}

/** Subscribe (or re-post the schedule) for the given local time. */
export async function enablePush(hh: number, mm: number): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error('Sign in to get reminders on this device.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for Chilaka in your settings.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = (await (await fetch(`${SYNC_ENDPOINT}/push/vapid`)).json()) as { publicKey: string };
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await fetch(`${SYNC_ENDPOINT}/push/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ subscription: sub.toJSON(), tz, hh, mm, enabled: true }),
  });
  if (!res.ok) throw new Error('Could not save the reminder. Try again.');
  await db.settings.put({ key: ENDPOINT_KEY, value: sub.endpoint });
}

export async function disablePush(): Promise<void> {
  const session = await getSession();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    if (session) {
      await fetch(`${SYNC_ENDPOINT}/push/subscribe`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
    }
    await sub.unsubscribe().catch(() => {});
  }
  await db.settings.delete(ENDPOINT_KEY);
}
