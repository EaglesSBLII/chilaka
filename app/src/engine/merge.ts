// Two-device state merge. Both devices pull remote, merge with local, and
// push the result — so progress made anywhere combines instead of clobbering.
// Every rule is monotone: merging can only preserve or grow progress, never
// lose it. Idempotent: merge(a, a) === a.

import type { BackupFile } from '../db/backup';
import { fnv1a } from '../db/backup';

type Row = Record<string, unknown>;

function rowsBy<T extends Row>(rows: unknown[] | undefined, key: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of (rows ?? []) as T[]) m.set(String(r[key]), r);
  return m;
}

function maxStr(a: unknown, b: unknown): unknown {
  if (a == null) return b;
  if (b == null) return a;
  return String(a) >= String(b) ? a : b;
}

function minNonNull(a: unknown, b: unknown): unknown {
  if (a == null) return b;
  if (b == null) return a;
  return String(a) <= String(b) ? a : b;
}

export function mergeBackups(local: BackupFile, remote: BackupFile): BackupFile {
  // newer export wins for "latest preference" style fields
  const newer = String(local.exportedAt) >= String(remote.exportedAt) ? local : remote;
  const L = local.data;
  const R = remote.data;
  const N = newer.data;
  const out: Record<string, unknown[]> = {};

  // ---- profile: field-wise, progress fields monotone, prefs from newer ----
  {
    const lp = (L.profile?.[0] ?? null) as Row | null;
    const rp = (R.profile?.[0] ?? null) as Row | null;
    if (lp && rp) {
      const np = (N.profile?.[0] ?? lp) as Row;
      // identity (name) belongs to the ORIGINAL device — pairing a fresh
      // phone must not rename the learner
      const original = String(lp.createdAt ?? '') <= String(rp.createdAt ?? '') ? lp : rp;
      out.profile = [
        {
          ...np,
          name: original.name ?? np.name,
          createdAt: minNonNull(lp.createdAt, rp.createdAt),
          onboarded: Boolean(lp.onboarded) || Boolean(rp.onboarded),
          placementDone: Boolean(lp.placementDone) || Boolean(rp.placementDone),
          startSection: Math.max(Number(lp.startSection ?? 1), Number(rp.startSection ?? 1)),
        },
      ];
    } else {
      out.profile = lp ? [lp] : rp ? [rp] : [];
    }
  }

  // ---- settings: per-key, newer export wins conflicts; sync/device-local keys dropped ----
  {
    const lm = rowsBy(L.settings, 'key');
    const rm = rowsBy(R.settings, 'key');
    const nm = rowsBy(N.settings, 'key');
    const keys = new Set([...lm.keys(), ...rm.keys()]);
    const rows: Row[] = [];
    for (const k of keys) {
      if (k.startsWith('sync')) continue; // pairing stays per-device
      const l = lm.get(k);
      const r = rm.get(k);
      rows.push((l && r ? (nm.get(k) ?? l) : (l ?? r))!);
    }
    out.settings = rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }

  // ---- unitProgress: union lessons, OR dialogue, earliest completion ----
  {
    const lm = rowsBy(L.unitProgress, 'unitId');
    const rm = rowsBy(R.unitProgress, 'unitId');
    const rows: Row[] = [];
    for (const id of new Set([...lm.keys(), ...rm.keys()])) {
      const l = lm.get(id);
      const r = rm.get(id);
      if (!l || !r) {
        rows.push((l ?? r)!);
        continue;
      }
      rows.push({
        unitId: id,
        lessonsDone: [...new Set([...(l.lessonsDone as string[]), ...(r.lessonsDone as string[])])].sort(),
        dialogueDone: Boolean(l.dialogueDone) || Boolean(r.dialogueDone),
        completedAt: minNonNull(l.completedAt, r.completedAt),
      });
    }
    out.unitProgress = rows.sort((a, b) => String(a.unitId).localeCompare(String(b.unitId)));
  }

  // ---- lessonProgress: keep the best of each ----
  {
    const lm = rowsBy(L.lessonProgress, 'id');
    const rm = rowsBy(R.lessonProgress, 'id');
    const rows: Row[] = [];
    for (const id of new Set([...lm.keys(), ...rm.keys()])) {
      const l = lm.get(id);
      const r = rm.get(id);
      if (!l || !r) {
        rows.push((l ?? r)!);
        continue;
      }
      rows.push({
        id,
        attempts: Math.max(Number(l.attempts ?? 0), Number(r.attempts ?? 0)),
        bestPct: Math.max(Number(l.bestPct ?? 0), Number(r.bestPct ?? 0)),
        lastCompletedAt: maxStr(l.lastCompletedAt, r.lastCompletedAt),
        xpEarned: Math.max(Number(l.xpEarned ?? 0), Number(r.xpEarned ?? 0)),
      });
    }
    out.lessonProgress = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // ---- srsCards: the more-reviewed card wins (ties → later review) ----
  {
    const lm = rowsBy(L.srsCards, 'id');
    const rm = rowsBy(R.srsCards, 'id');
    const rows: Row[] = [];
    for (const id of new Set([...lm.keys(), ...rm.keys()])) {
      const l = lm.get(id);
      const r = rm.get(id);
      if (!l || !r) {
        rows.push((l ?? r)!);
        continue;
      }
      const lr = Number(l.reps ?? 0);
      const rr = Number(r.reps ?? 0);
      if (lr !== rr) rows.push(lr > rr ? l : r);
      else rows.push(String(l.last_review ?? '') >= String(r.last_review ?? '') ? l : r);
    }
    out.srsCards = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // ---- streaks: monotone maxima ----
  {
    const l = (L.streaks?.[0] ?? null) as Row | null;
    const r = (R.streaks?.[0] ?? null) as Row | null;
    if (l && r) {
      out.streaks = [
        {
          id: 'main',
          current: Math.max(Number(l.current ?? 0), Number(r.current ?? 0)),
          longest: Math.max(Number(l.longest ?? 0), Number(r.longest ?? 0)),
          lastActiveDay: maxStr(l.lastActiveDay, r.lastActiveDay),
          freezesOwned: Math.max(Number(l.freezesOwned ?? 0), Number(r.freezesOwned ?? 0)),
          freezeUsedOn: [...new Set([...(l.freezeUsedOn as string[]), ...(r.freezeUsedOn as string[])])].sort(),
        },
      ];
    } else {
      out.streaks = l ? [l] : r ? [r] : [];
    }
  }

  // ---- xpEvents: union, deduped by identity (drop per-device autoincrement ids) ----
  {
    const seen = new Map<string, Row>();
    for (const e of [...((L.xpEvents ?? []) as Row[]), ...((R.xpEvents ?? []) as Row[])]) {
      const sig = `${e.ts}|${e.source}|${e.refId}|${e.amount}`;
      if (!seen.has(sig)) {
        const { id: _dropped, ...rest } = e as { id?: unknown } & Row;
        seen.set(sig, rest);
      }
    }
    out.xpEvents = [...seen.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }

  // ---- coinEvents: union, deduped by identity (same shape of rule as xpEvents) ----
  {
    const seen = new Map<string, Row>();
    for (const e of [...((L.coinEvents ?? []) as Row[]), ...((R.coinEvents ?? []) as Row[])]) {
      const sig = `${e.ts}|${e.kind}|${e.refId}|${e.delta}`;
      if (!seen.has(sig)) {
        const { id: _dropped, ...rest } = e as { id?: unknown } & Row;
        seen.set(sig, rest);
      }
    }
    out.coinEvents = [...seen.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }

  // ---- quests: per id, progress is a maximum; a claim anywhere counts ----
  {
    const lq = rowsBy(L.quests, 'id');
    const rq = rowsBy(R.quests, 'id');
    const rows: Row[] = [];
    for (const k of new Set([...lq.keys(), ...rq.keys()])) {
      const l = lq.get(k);
      const r = rq.get(k);
      if (l && r) {
        const claimed = (l.claimedAt ? l : r.claimedAt ? r : null) as Row | null;
        rows.push({
          ...l,
          progress: Math.max(Number(l.progress ?? 0), Number(r.progress ?? 0)),
          claimedAt: minNonNull(l.claimedAt ?? null, r.claimedAt ?? null),
          reward: claimed ? (claimed.reward ?? null) : null,
        });
      } else rows.push((l ?? r)!);
    }
    out.quests = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // ---- badges: per id, highest tier, earliest earnedAt ----
  {
    const lb = rowsBy(L.badges, 'id');
    const rb = rowsBy(R.badges, 'id');
    const rows: Row[] = [];
    for (const k of new Set([...lb.keys(), ...rb.keys()])) {
      const l = lb.get(k);
      const r = rb.get(k);
      if (l && r) {
        const hi = Number(l.tier ?? 0) >= Number(r.tier ?? 0) ? l : r;
        rows.push({ ...hi, earnedAt: Number(l.tier) === Number(r.tier) ? minNonNull(l.earnedAt, r.earnedAt) : hi.earnedAt });
      } else rows.push((l ?? r)!);
    }
    out.badges = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // ---- reminders: newer export wins wholesale (a schedule is one intent) ----
  out.reminders = ((N.reminders ?? []) as Row[]).map(({ id: _dropped, ...rest }) => rest);

  // ---- meta: per-key, newer wins ----
  {
    const lm = rowsBy(L.meta, 'key');
    const rm = rowsBy(R.meta, 'key');
    const nm = rowsBy(N.meta, 'key');
    const rows: Row[] = [];
    for (const k of new Set([...lm.keys(), ...rm.keys()])) {
      const l = lm.get(k);
      const r = rm.get(k);
      rows.push((l && r ? (nm.get(k) ?? l) : (l ?? r))!);
    }
    out.meta = rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }

  const json = JSON.stringify(out);
  return {
    app: 'chilaka',
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    exportedAt: new Date().toISOString(),
    checksum: fnv1a(json),
    data: out as BackupFile['data'],
  };
}
