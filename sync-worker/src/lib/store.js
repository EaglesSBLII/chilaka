// Storage shim: progress slots live either in KV (legacy, `sync:<key>`) or in
// the D1 `progress` table (account-owned). A slot is in exactly one place:
// D1 wins when a row exists, otherwise KV. Without a D1 binding (local dev)
// everything is KV-only.

const kvKey = (key) => `sync:${key}`;

// A D1 read that fails (binding present but migration not applied yet) must
// not take legacy KV sync down with it — treat it as "no row".
async function d1First(env, sql, ...args) {
  if (!env.DB) return null;
  try {
    return await env.DB.prepare(sql).bind(...args).first();
  } catch (err) {
    console.warn('D1 read failed, falling back to KV:', err.message ?? err);
    return null;
  }
}

const d1Row = (env, key) =>
  d1First(env, 'SELECT rev, updated_at, last_active_day, data FROM progress WHERE slot_key = ?', key);

// The app's envelope.data is a BackupFile; the streak lives at data.streaks[0].
export function lastActiveDay(envelope) {
  const day = envelope?.data?.data?.streaks?.[0]?.lastActiveDay;
  return typeof day === 'string' ? day : null;
}

// → {rev, updatedAt, data} or null. A rev-0 D1 row is a placeholder created at
// signup so later PUTs land in D1; it reads as "nothing synced yet".
export async function loadSlot(env, key) {
  const row = await d1Row(env, key);
  if (row) {
    if (!row.rev) return null;
    return { rev: row.rev, updatedAt: row.updated_at, data: JSON.parse(row.data) };
  }
  return env.SYNC.get(kvKey(key), 'json');
}

export async function slotExists(env, key) {
  if (await d1Row(env, key)) return true;
  return (await env.SYNC.get(kvKey(key))) !== null;
}

export async function saveSlot(env, key, envelope) {
  if (env.DB) {
    const row = await d1First(env, 'SELECT 1 AS one FROM progress WHERE slot_key = ?', key);
    if (row) {
      await env.DB.prepare(
        'UPDATE progress SET rev = ?, updated_at = ?, last_active_day = ?, data = ? WHERE slot_key = ?',
      )
        .bind(envelope.rev, envelope.updatedAt, lastActiveDay(envelope), JSON.stringify(envelope.data), key)
        .run();
      return;
    }
  }
  await env.SYNC.put(kvKey(key), JSON.stringify(envelope));
}

// Copy a KV envelope into D1 once (when an account claims a legacy slot).
// → true if a D1 row exists afterwards.
export async function promoteSlot(env, key) {
  if (!env.DB) return false;
  if (await d1Row(env, key)) return true;
  const envelope = await env.SYNC.get(kvKey(key), 'json');
  if (!envelope) return false;
  await env.DB.prepare(
    'INSERT INTO progress (slot_key, rev, updated_at, last_active_day, data) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(key, envelope.rev ?? 0, envelope.updatedAt ?? Date.now(), lastActiveDay(envelope), JSON.stringify(envelope.data ?? null))
    .run();
  return true;
}

// Make sure an account slot has a D1 row (promoting KV data if any, else an
// empty placeholder) so all future writes go to D1.
export async function ensureSlotRow(env, key) {
  if (!env.DB) return;
  if (await promoteSlot(env, key)) return;
  await env.DB.prepare(
    'INSERT OR IGNORE INTO progress (slot_key, rev, updated_at, last_active_day, data) VALUES (?, 0, ?, NULL, ?)',
  )
    .bind(key, Date.now(), 'null')
    .run();
}
