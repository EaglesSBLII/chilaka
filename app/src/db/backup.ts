// Full-state export/import. The export JSON is the Mac↔iPhone sync vehicle
// and the desktop auto-backup payload. A checksum guards against truncation.

import { db, SCHEMA_VERSION } from './schema';

export interface BackupFile {
  app: 'chilaka';
  schemaVersion: number;
  exportedAt: string;
  checksum: string; // FNV-1a of the data JSON string
  data: Record<string, unknown[]>;
}

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const TABLES = [
  'profile',
  'settings',
  'unitProgress',
  'lessonProgress',
  'srsCards',
  'streaks',
  'xpEvents',
  'reminders',
  'meta',
  'coinEvents',
  'quests',
  'badges',
] as const;

export async function exportAll(now = new Date()): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    data[t] = await db.table(t).toArray();
  }
  const json = JSON.stringify(data);
  return {
    app: 'chilaka',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    checksum: fnv1a(json),
    data,
  };
}

export class BackupError extends Error {}

export function validateBackup(raw: unknown): BackupFile {
  const b = raw as BackupFile;
  if (!b || typeof b !== 'object' || b.app !== 'chilaka') {
    throw new BackupError('Not a Chilaka backup file.');
  }
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError('Backup was made by a newer version of the app.');
  }
  if (!b.data || typeof b.data !== 'object') {
    throw new BackupError('Backup contains no data.');
  }
  const json = JSON.stringify(b.data);
  if (fnv1a(json) !== b.checksum) {
    throw new BackupError('Backup file is corrupted (checksum mismatch).');
  }
  return b;
}

/** Settings that belong to this install, not to the learner's progress: sync
 *  pairing (endpoint, slot key, paused flag) and the signed-in account session.
 *  A backup or a sync merge must never replace them — doing so signed the
 *  user out on the next launch. */
export const isDeviceLocalSetting = (key: unknown): boolean => typeof key === 'string' && key.startsWith('sync');

/** Replace ALL local state with the backup's contents (atomic), keeping this
 *  device's own settings (see `isDeviceLocalSetting`).
 *
 *  `unlessChangedSince`: the export this import was computed from (a sync
 *  merge). If anything was written locally after that export, nothing is
 *  imported and the result is false — otherwise the import would silently
 *  erase that write (a coin reward, a quest claim, a purchase). The check and
 *  the rewrite share one transaction, so no write can slip in between. */
export async function importAll(raw: unknown, unlessChangedSince?: BackupFile): Promise<boolean> {
  const b = validateBackup(raw);
  return db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    if (unlessChangedSince) {
      const now: Record<string, unknown[]> = {};
      for (const t of TABLES) now[t] = await db.table(t).toArray();
      if (JSON.stringify(now) !== JSON.stringify(unlessChangedSince.data)) return false;
    }
    const deviceLocal = (await db.settings.toArray()).filter((r) => isDeviceLocalSetting(r.key));
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = b.data[t];
      if (Array.isArray(rows) && rows.length > 0) {
        await db.table(t).bulkPut(rows as never[]);
      }
    }
    // Incoming sync* rows (another device's pairing) lose to ours.
    await db.settings.bulkDelete((b.data.settings ?? []).map((r) => (r as { key: unknown }).key).filter(isDeviceLocalSetting) as string[]);
    if (deviceLocal.length > 0) await db.settings.bulkPut(deviceLocal);
    return true;
  });
}
