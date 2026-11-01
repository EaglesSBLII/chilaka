import type { PlatformBridge, ReminderSpec } from './types';

class ElectronBridge implements PlatformBridge {
  kind = 'electron' as const;
  remindersSupported = true;
  asrAvailable() {
    return window.chilakaBridge!.asrAvailable();
  }
  transcribe(wav: ArrayBuffer) {
    return window.chilakaBridge!.transcribe(wav);
  }
  speak(text: string) {
    return window.chilakaBridge!.speak(text);
  }
  setReminders(reminders: ReminderSpec[]) {
    return window.chilakaBridge!.setReminders(reminders);
  }
  saveBackup(json: string) {
    return window.chilakaBridge!.saveBackup(json);
  }
  async requestPersistence() {
    return true; // Electron userData is durable by construction
  }
}

class WebBridge implements PlatformBridge {
  kind = 'web' as const;
  remindersSupported = false;
  async asrAvailable() {
    // Real speech scoring on the phone: recordings go to YOUR sync worker,
    // which runs Whisper via Workers AI. Availability = paired; an offline
    // attempt fails fast and falls back to echo mode. (navigator.onLine is
    // unreliable inside installed iOS web apps — never gate on it.)
    const { sync } = await import('../sync');
    return Boolean(sync.endpoint && sync.key);
  }
  async transcribe(wav: ArrayBuffer): Promise<{ ok: boolean; text: string; error?: string }> {
    const { sync } = await import('../sync');
    if (!sync.endpoint || !sync.key) {
      return { ok: false, text: '', error: 'Pair sync in Settings to enable speech scoring.' };
    }
    try {
      const res = await fetch(`${sync.endpoint}/asr/${sync.key}`, {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav,
      });
      if (!res.ok) return { ok: false, text: '', error: `speech service unavailable (${res.status})` };
      const data = (await res.json()) as { text?: string };
      return { ok: true, text: String(data.text ?? '').trim() };
    } catch {
      return { ok: false, text: '', error: 'offline' };
    }
  }
  async speak() {
    return null; // pre-rendered audio only
  }
  async setReminders() {
    // no OS scheduler on the web; reminder times still persist in Dexie
  }
  async saveBackup(json: string) {
    // trigger a download the user can AirDrop / save
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chilaka-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async requestPersistence() {
    try {
      if (navigator.storage?.persist) {
        return await navigator.storage.persist();
      }
    } catch {
      // ignored — persistence is best-effort on the web
    }
    return false;
  }
}

export const platform: PlatformBridge =
  typeof window !== 'undefined' && window.chilakaBridge ? new ElectronBridge() : new WebBridge();
