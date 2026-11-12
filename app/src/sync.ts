// Always-on progress sync between devices. Both sides pull the shared remote
// state, merge it with local (engine/merge — monotone, never loses progress),
// apply the merged result locally, and push it back with optimistic
// concurrency (rev numbers; 409 → re-pull, re-merge, retry).
//
// Pairing: one long random key names your slot on the sync server; the
// pairing code carries {endpoint, key} and is entered once per device.

import { db } from './db/schema';
import { exportAll, importAll, validateBackup, type BackupFile } from './db/backup';
import { mergeBackups } from './engine/merge';

export type SyncStatus = 'unconfigured' | 'idle' | 'syncing' | 'error' | 'disabled';

interface RemoteEnvelope {
  rev: number;
  updatedAt?: number;
  data: BackupFile;
}

type Listener = () => void;

const DEBOUNCE_MS = 8_000;
const PERIODIC_MS = 4 * 60_000;

class SyncManager {
  endpoint = '';
  key = '';
  enabled = false;
  status: SyncStatus = 'unconfigured';
  lastSyncAt: string | null = null;
  lastError: string | null = null;
  /** host tells us when it's safe to apply a merged state (not mid-lesson) */
  canApply: () => boolean = () => true;
  /** host hook to re-hydrate app state after an apply */
  onApplied: () => Promise<void> = async () => {};

  private listeners = new Set<Listener>();
  private inFlight = false;
  private pendingAgain = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private setStatus(s: SyncStatus, err: string | null = null): void {
    this.status = s;
    this.lastError = err;
    this.emit();
  }

  async init(): Promise<void> {
    const e = await db.settings.get('syncEndpoint');
    const k = await db.settings.get('syncKey');
    const en = await db.settings.get('syncEnabled');
    const at = await db.settings.get('syncLastAt');
    this.endpoint = typeof e?.value === 'string' ? (e.value as string) : '';
    this.key = typeof k?.value === 'string' ? (k.value as string) : '';
    this.enabled = Boolean(en?.value) && Boolean(this.endpoint) && Boolean(this.key);
    this.lastSyncAt = typeof at?.value === 'string' ? (at.value as string) : null;
    this.status = this.enabled ? 'idle' : this.endpoint && this.key ? 'disabled' : 'unconfigured';

    window.addEventListener('online', () => this.requestSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.requestSync();
    });
    if (this.enabled) {
      this.startPeriodic();
      this.requestSync();
    }
    this.emit();
  }

  /** Pairing code = CHK1-<base64url({e, k})> */
  static encodeCode(endpoint: string, key: string): string {
    const raw = btoa(JSON.stringify({ e: endpoint, k: key }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `CHK1-${raw}`;
  }

  static decodeCode(code: string): { endpoint: string; key: string } | null {
    const m = code.trim().match(/^CHK1-([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    try {
      const raw = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const parsed = JSON.parse(atob(raw)) as { e?: string; k?: string };
      if (!parsed.e || !parsed.k || !/^[a-f0-9]{48,64}$/.test(parsed.k)) return null;
      return { endpoint: parsed.e, key: parsed.k };
    } catch {
      return null;
    }
  }

  pairingCode(): string | null {
    if (!this.endpoint || !this.key) return null;
    return SyncManager.encodeCode(this.endpoint, this.key);
  }

  /**
   * Zero-touch sync: if this install has never been configured, mint a key
   * and start syncing silently. Respects an explicit user Pause (which sets
   * syncEnabled=false but keeps the key).
   */
  async autoEnableIfNeeded(endpoint: string): Promise<void> {
    if (!endpoint) return;
    if (this.endpoint && this.key) return; // configured (maybe paused) — leave it
    const wasDisabled = await db.settings.get('syncEnabled');
    if (wasDisabled && wasDisabled.value === false) return; // explicit opt-out
    await this.setUp(endpoint);
  }

  /** First device: mint a fresh key against the given endpoint and turn on. */
  async setUp(endpoint: string): Promise<void> {
    const bytes = new Uint8Array(28);
    crypto.getRandomValues(bytes);
    this.key = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    this.endpoint = endpoint.replace(/\/+$/, '');
    await this.persistConfig(true);
    this.startPeriodic();
    await this.syncNow();
  }

  /** Accounts: point this device at the account's slot (merge happens on the next sync). */
  async useSlot(endpoint: string, key: string): Promise<void> {
    this.endpoint = endpoint;
    this.key = key;
    await this.persistConfig(true);
    this.startPeriodic();
  }

  /** Second device: paste the pairing code from the first. */
  async pair(code: string): Promise<boolean> {
    const decoded = SyncManager.decodeCode(code);
    if (!decoded) return false;
    this.endpoint = decoded.endpoint;
    this.key = decoded.key;
    await this.persistConfig(true);
    this.startPeriodic();
    await this.syncNow();
    return true;
  }

  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on && Boolean(this.endpoint) && Boolean(this.key);
    await db.settings.put({ key: 'syncEnabled', value: this.enabled });
    if (this.enabled) {
      this.startPeriodic();
      this.requestSync();
      this.setStatus('idle');
    } else {
      this.stopPeriodic();
      this.setStatus(this.endpoint && this.key ? 'disabled' : 'unconfigured');
    }
  }

  private async persistConfig(enable: boolean): Promise<void> {
    this.enabled = enable;
    await db.settings.bulkPut([
      { key: 'syncEndpoint', value: this.endpoint },
      { key: 'syncKey', value: this.key },
      { key: 'syncEnabled', value: enable },
    ]);
    this.emit();
  }

  private startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => this.requestSync(), PERIODIC_MS);
  }

  private stopPeriodic(): void {
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.periodicTimer = null;
  }

  /** Debounced sync — call freely after any progress event. */
  requestSync(): void {
    if (!this.enabled) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.syncNow(), DEBOUNCE_MS);
  }

  async syncNow(): Promise<void> {
    if (!this.enabled || !this.endpoint || !this.key) return;
    if (this.inFlight) {
      this.pendingAgain = true;
      return;
    }
    this.inFlight = true;
    this.setStatus('syncing');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const local = await exportAll();
        const remote = await this.pull();
        const merged = remote ? mergeBackups(local, remote.data) : local;

        // apply remote-side progress locally (skip mid-lesson; next sync catches up).
        // Compared in merged form: a raw export never equals a merge (table
        // order, event ids, device settings), and importing when the remote
        // added nothing would rewrite the whole database on every sync.
        const changedLocally = remote && JSON.stringify(merged.data) !== JSON.stringify(mergeBackups(local, local).data);
        if (changedLocally && this.canApply()) {
          // refuses if something was written here since the export: that
          // write is not in `merged`, and the next round picks it up
          if (await importAll(merged, local)) await this.onApplied();
          else this.pendingAgain = true;
        }

        // nothing new for the server? skip the write entirely — keeps the
        // free storage-write quota for actual progress, not idle app-opens
        if (remote && JSON.stringify(merged.data) === JSON.stringify(remote.data.data)) {
          this.lastSyncAt = new Date().toISOString();
          await db.settings.put({ key: 'syncLastAt', value: this.lastSyncAt });
          this.setStatus('idle');
          break;
        }

        const pushRev = (remote?.rev ?? 0) + 1;
        const ok = await this.push(pushRev, merged);
        if (ok) {
          this.lastSyncAt = new Date().toISOString();
          await db.settings.put({ key: 'syncLastAt', value: this.lastSyncAt });
          this.setStatus('idle');
          break;
        }
        // 409 — someone else pushed between our pull and push; go around again
        if (attempt === 2) throw new Error('sync conflict retries exhausted');
      }
    } catch (err) {
      this.setStatus('error', err instanceof Error ? err.message : String(err));
    } finally {
      this.inFlight = false;
      if (this.pendingAgain) {
        this.pendingAgain = false;
        this.requestSync();
      }
    }
  }

  private async pull(): Promise<{ rev: number; data: BackupFile } | null> {
    const res = await fetch(`${this.endpoint}/${this.key}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`sync server error (${res.status})`);
    const env = (await res.json()) as RemoteEnvelope;
    if (!env || typeof env.rev !== 'number' || !env.data) return null;
    return { rev: env.rev, data: validateBackup(env.data) };
  }

  private async push(rev: number, data: BackupFile): Promise<boolean> {
    const res = await fetch(`${this.endpoint}/${this.key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rev, data }),
    });
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`sync push failed (${res.status})`);
    return true;
  }
}

export const sync = new SyncManager();
