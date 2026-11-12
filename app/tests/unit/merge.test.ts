import { describe, expect, it } from 'vitest';
import { mergeBackups } from '../../src/engine/merge';
import { fnv1a, validateBackup, type BackupFile } from '../../src/db/backup';

function mk(data: Record<string, unknown[]>, exportedAt = '2026-07-18T10:00:00Z'): BackupFile {
  const json = JSON.stringify(data);
  return { app: 'chilaka', schemaVersion: 2, exportedAt, checksum: fnv1a(json), data: data as BackupFile['data'] };
}

const baseProfile = {
  id: 'main',
  name: 'Ravi',
  createdAt: '2026-07-01T00:00:00Z',
  onboarded: true,
  placementDone: true,
  startSection: 1,
  difficulty: 'standard',
  scriptMode: 'roman+telugu',
  timezone: 'America/Los_Angeles',
  soundOn: true,
};

function deviceA(): BackupFile {
  return mk(
    {
      profile: [{ ...baseProfile }],
      settings: [{ key: 'musicEnabled', value: true }, { key: 'syncKey', value: 'SECRET-A' }],
      unitProgress: [{ unitId: 'u01', lessonsDone: ['l1', 'l2'], dialogueDone: false, completedAt: null }],
      lessonProgress: [
        { id: 'u01:l1', attempts: 2, bestPct: 0.9, lastCompletedAt: '2026-07-17T10:00:00Z', xpEarned: 30 },
      ],
      srsCards: [
        { id: 'u01-i01', reps: 3, last_review: '2026-07-17T10:00:00Z', due: '2026-07-20T10:00:00Z' },
        { id: 'u01-i02', reps: 1, last_review: '2026-07-16T10:00:00Z', due: '2026-07-18T10:00:00Z' },
      ],
      streaks: [{ id: 'main', current: 3, longest: 5, lastActiveDay: '2026-07-17', freezesOwned: 1, freezeUsedOn: ['2026-07-10'] }],
      xpEvents: [
        { id: 1, ts: '2026-07-17T10:00:00Z', amount: 30, source: 'lesson', refId: 'u01:l1', day: '2026-07-17' },
      ],
      reminders: [{ id: 1, hh: 19, mm: 30, enabled: true, label: 'Evening' }],
      meta: [{ key: 'installId', value: 'mac' }],
    },
    '2026-07-18T09:00:00Z',
  );
}

function deviceB(): BackupFile {
  return mk(
    {
      profile: [{ ...baseProfile, difficulty: 'intense', startSection: 3 }],
      settings: [{ key: 'musicEnabled', value: false }, { key: 'syncEndpoint', value: 'x' }],
      unitProgress: [{ unitId: 'u01', lessonsDone: ['l2', 'l3'], dialogueDone: true, completedAt: null }],
      lessonProgress: [
        { id: 'u01:l1', attempts: 1, bestPct: 1.0, lastCompletedAt: '2026-07-18T08:00:00Z', xpEarned: 25 },
        { id: 'u01:l3', attempts: 1, bestPct: 0.8, lastCompletedAt: '2026-07-18T08:30:00Z', xpEarned: 20 },
      ],
      srsCards: [
        { id: 'u01-i01', reps: 2, last_review: '2026-07-18T08:00:00Z', due: '2026-07-19T10:00:00Z' },
        { id: 'u01-i03', reps: 1, last_review: '2026-07-18T08:00:00Z', due: '2026-07-21T10:00:00Z' },
      ],
      streaks: [{ id: 'main', current: 4, longest: 4, lastActiveDay: '2026-07-18', freezesOwned: 0, freezeUsedOn: [] }],
      xpEvents: [
        { id: 1, ts: '2026-07-17T10:00:00Z', amount: 30, source: 'lesson', refId: 'u01:l1', day: '2026-07-17' },
        { id: 2, ts: '2026-07-18T08:00:00Z', amount: 25, source: 'lesson', refId: 'u01:l1', day: '2026-07-18' },
      ],
      reminders: [{ id: 1, hh: 8, mm: 0, enabled: true, label: 'Morning' }],
      meta: [{ key: 'installId', value: 'iphone' }],
    },
    '2026-07-18T09:30:00Z', // newer export
  );
}

describe('mergeBackups', () => {
  it('is idempotent: merge(a, a) preserves everything', () => {
    const a = deviceA();
    const m = mergeBackups(a, deviceA());
    expect(m.data.unitProgress).toEqual(a.data.unitProgress);
    expect(m.data.xpEvents).toHaveLength(1);
    expect((m.data.streaks[0] as { current: number }).current).toBe(3);
  });

  it('produces a valid importable backup (checksum passes)', () => {
    const m = mergeBackups(deviceA(), deviceB());
    expect(() => validateBackup(m)).not.toThrow();
  });

  it('unions lesson completion across devices', () => {
    const m = mergeBackups(deviceA(), deviceB());
    const up = m.data.unitProgress[0] as { lessonsDone: string[]; dialogueDone: boolean };
    expect([...up.lessonsDone].sort()).toEqual(['l1', 'l2', 'l3']);
    expect(up.dialogueDone).toBe(true);
  });

  it('unions XP events without double-counting shared history', () => {
    const m = mergeBackups(deviceA(), deviceB());
    expect(m.data.xpEvents).toHaveLength(2); // shared event deduped
    const total = (m.data.xpEvents as { amount: number }[]).reduce((s, e) => s + e.amount, 0);
    expect(total).toBe(55);
  });

  it('keeps the best lesson stats and both devices’ lessons', () => {
    const m = mergeBackups(deviceA(), deviceB());
    const rows = m.data.lessonProgress as { id: string; bestPct: number; attempts: number }[];
    const l1 = rows.find((r) => r.id === 'u01:l1')!;
    expect(l1.bestPct).toBe(1.0);
    expect(l1.attempts).toBe(2);
    expect(rows.some((r) => r.id === 'u01:l3')).toBe(true);
  });

  it('takes the more-reviewed SRS card and unions the deck', () => {
    const m = mergeBackups(deviceA(), deviceB());
    const cards = m.data.srsCards as { id: string; reps: number }[];
    expect(cards.find((c) => c.id === 'u01-i01')!.reps).toBe(3); // A reviewed more
    expect(cards.map((c) => c.id).sort()).toEqual(['u01-i01', 'u01-i02', 'u01-i03']);
  });

  it('streak follows the side that was active most recently; longest only grows', () => {
    const m = mergeBackups(deviceA(), deviceB());
    const s = m.data.streaks[0] as { current: number; longest: number; lastActiveDay: string; freezesOwned: number };
    expect(s.current).toBe(4);
    expect(s.longest).toBe(5);
    expect(s.lastActiveDay).toBe('2026-07-18');
    expect(s.freezesOwned).toBe(0);
  });

  it('a streak that broke here is not resurrected by an older upload, nor a spent freeze refunded', () => {
    const stale = deviceA();
    stale.data.streaks = [{ id: 'main', current: 10, longest: 10, lastActiveDay: '2026-07-10', freezesOwned: 1, freezeUsedOn: [] }];
    const now = deviceA();
    now.data.streaks = [{ id: 'main', current: 1, longest: 10, lastActiveDay: '2026-07-18', freezesOwned: 0, freezeUsedOn: ['2026-07-12'] }];
    for (const m of [mergeBackups(now, stale), mergeBackups(stale, now)]) {
      const s = m.data.streaks[0] as { current: number; longest: number; lastActiveDay: string; freezesOwned: number; freezeUsedOn: string[] };
      expect(s.current).toBe(1);
      expect(s.longest).toBe(10);
      expect(s.lastActiveDay).toBe('2026-07-18');
      expect(s.freezesOwned).toBe(0);
      expect(s.freezeUsedOn).toEqual(['2026-07-12']);
    }
  });

  it('never propagates device pairing settings', () => {
    const m = mergeBackups(deviceA(), deviceB());
    const keys = (m.data.settings as { key: string }[]).map((s) => s.key);
    expect(keys).not.toContain('syncKey');
    expect(keys).not.toContain('syncEndpoint');
    expect(keys).toContain('musicEnabled');
  });

  it('preference conflicts go to the newer export', () => {
    const m = mergeBackups(deviceA(), deviceB());
    const p = m.data.profile[0] as { difficulty: string; startSection: number };
    expect(p.difficulty).toBe('intense'); // B exported later
    expect(p.startSection).toBe(3); // monotone max
    const music = (m.data.settings as { key: string; value: unknown }[]).find((s) => s.key === 'musicEnabled')!;
    expect(music.value).toBe(false); // B newer
  });

  it('is symmetric for progress regardless of argument order', () => {
    const m1 = mergeBackups(deviceA(), deviceB());
    const m2 = mergeBackups(deviceB(), deviceA());
    expect(m1.data.unitProgress).toEqual(m2.data.unitProgress);
    expect(m1.data.xpEvents).toEqual(m2.data.xpEvents);
    expect(m1.data.srsCards).toEqual(m2.data.srsCards);
    expect(m1.data.streaks).toEqual(m2.data.streaks);
  });

  it('handles a fresh device (empty tables) without losing anything', () => {
    const empty = mk({ profile: [], settings: [], unitProgress: [], lessonProgress: [], srsCards: [], streaks: [], xpEvents: [], reminders: [], meta: [] });
    const m = mergeBackups(empty, deviceA());
    expect(m.data.unitProgress).toHaveLength(1);
    expect(m.data.xpEvents).toHaveLength(1);
    expect((m.data.profile[0] as { name: string }).name).toBe('Ravi');
  });
});

describe('mergeBackups: coins, quests, badges', () => {
  const coinA = { id: 1, ts: '2026-07-17T10:00:00Z', delta: 10, kind: 'lesson', refId: 'u01:l1', day: '2026-07-17' };
  const coinB = { id: 1, ts: '2026-07-18T08:00:00Z', delta: -200, kind: 'spend', refId: 'freeze', day: '2026-07-18' };
  const questA = { id: '2026-07-18:lessons', day: '2026-07-18', kind: 'lessons', target: 2, progress: 1, claimedAt: null, reward: null };
  const questB = { ...questA, progress: 2, claimedAt: '2026-07-18T09:00:00Z', reward: 22 };
  const badgeA = { id: 'first-steps', tier: 1, earnedAt: '2026-07-10T00:00:00Z' };
  const badgeB = { id: 'first-steps', tier: 2, earnedAt: '2026-07-18T00:00:00Z' };
  const a = () => mk({ ...deviceA().data, coinEvents: [coinA], quests: [questA], badges: [badgeA] }, '2026-07-18T09:00:00Z');
  const b = () => mk({ ...deviceA().data, coinEvents: [coinA, coinB], quests: [questB], badges: [badgeB] }, '2026-07-18T10:00:00Z');

  it('unions the coin ledger without double counting and drops ids', () => {
    const m = mergeBackups(a(), b()).data as unknown as { coinEvents: Record<string, unknown>[] };
    expect(m.coinEvents).toHaveLength(2);
    expect(m.coinEvents.every((e) => !('id' in e))).toBe(true);
    expect(m.coinEvents.reduce((s, e) => s + Number(e.delta), 0)).toBe(-190);
  });
  it('quest progress is a maximum and a claim anywhere carries its reward', () => {
    const m = mergeBackups(a(), b()).data as unknown as { quests: typeof questB[] };
    expect(m.quests).toEqual([questB]);
    const m2 = mergeBackups(b(), a()).data as unknown as { quests: typeof questB[] };
    expect(m2.quests).toEqual([questB]);
  });
  it('badges keep the higher tier', () => {
    const m = mergeBackups(a(), b()).data as unknown as { badges: typeof badgeB[] };
    expect(m.badges).toEqual([badgeB]);
    const same = mergeBackups(a(), mk({ ...deviceA().data, badges: [{ ...badgeA, earnedAt: '2026-07-01T00:00:00Z' }] })).data as unknown as { badges: typeof badgeA[] };
    expect(same.badges[0].earnedAt).toBe('2026-07-01T00:00:00Z');
  });
  it('tolerates an old backup without the new tables', () => {
    const m = mergeBackups(deviceA(), b()).data as unknown as { coinEvents: unknown[]; quests: unknown[]; badges: unknown[] };
    expect(m.coinEvents).toHaveLength(2);
    expect(m.quests).toHaveLength(1);
    expect(m.badges).toHaveLength(1);
  });
});

describe('mergeBackups: streak freezes follow the ledgers', () => {
  type S = { freezesOwned: number; freezeUsedOn: string[] };
  const xp = (ts: string, amount: number) => ({ ts, amount, source: 'lesson', refId: `l:${ts}`, day: ts.slice(0, 10) });
  const seed = { ts: '2026-07-16T09:00:00Z', delta: 500, kind: 'quest', refId: 'seed', day: '2026-07-16' };
  const buy = (ts: string) => ({ ts, delta: -200, kind: 'spend', refId: 'freeze', day: ts.slice(0, 10) });
  const streak = (freezesOwned: number, lastActiveDay = '2026-07-17', freezeUsedOn: string[] = []) => ({ id: 'main', current: 3, longest: 5, lastActiveDay, freezesOwned, freezeUsedOn });
  const dev = (over: Record<string, unknown[]>, at = '2026-07-18T09:00:00Z') => mk({ ...deviceA().data, coinEvents: [], ...over }, at);
  const owned = (m: BackupFile) => (m.data.streaks[0] as S).freezesOwned;

  it('a freeze just bought survives the merge with this device’s own earlier upload', () => {
    const local = dev({ streaks: [streak(1)], coinEvents: [seed, buy('2026-07-17T12:00:00Z')] }, '2026-07-17T12:01:00Z');
    const remote = dev({ streaks: [streak(0)], coinEvents: [seed] }, '2026-07-17T11:00:00Z');
    expect(owned(mergeBackups(local, remote))).toBe(1);
    expect(owned(mergeBackups(remote, local))).toBe(1);
  });

  it('a freeze earned through XP survives the same way', () => {
    const shared = xp('2026-07-16T10:00:00Z', 290);
    const local = dev({ streaks: [streak(1)], xpEvents: [shared, xp('2026-07-17T10:00:00Z', 20)] });
    const remote = dev({ streaks: [streak(0)], xpEvents: [shared] });
    expect(owned(mergeBackups(local, remote))).toBe(1);
    expect(owned(mergeBackups(remote, local))).toBe(1);
  });

  it('merging again changes nothing (idempotent) and the order does not matter', () => {
    const local = dev({ streaks: [streak(1)], coinEvents: [seed, buy('2026-07-17T12:00:00Z')] });
    const remote = dev({ streaks: [streak(0)], coinEvents: [seed] });
    const once = mergeBackups(local, remote);
    expect(mergeBackups(once, remote).data.streaks).toEqual(once.data.streaks);
    expect(mergeBackups(remote, once).data.streaks).toEqual(once.data.streaks);
    expect(mergeBackups(once, once).data.streaks).toEqual(once.data.streaks);
    expect(mergeBackups(remote, local).data.streaks).toEqual(once.data.streaks);
  });

  it('two devices crossing the same XP threshold offline earn one freeze, not two', () => {
    const shared = xp('2026-07-16T10:00:00Z', 290);
    const a = dev({ streaks: [streak(1)], xpEvents: [shared, xp('2026-07-17T10:00:00Z', 20)] });
    const b = dev({ streaks: [streak(1)], xpEvents: [shared, xp('2026-07-17T11:00:00Z', 20)] });
    expect(owned(mergeBackups(a, b))).toBe(1);
  });

  it('a freeze bought on each device counts twice, up to the cap', () => {
    const a = dev({ streaks: [streak(1)], coinEvents: [seed, buy('2026-07-17T12:00:00Z')] });
    const b = dev({ streaks: [streak(1)], coinEvents: [seed, buy('2026-07-17T13:00:00Z')] });
    expect(owned(mergeBackups(a, b))).toBe(2);
    const c = dev({ streaks: [streak(2)], coinEvents: [seed, buy('2026-07-17T12:00:00Z'), buy('2026-07-17T12:30:00Z')] });
    expect(owned(mergeBackups(c, b))).toBe(2); // three paid for, two is the most anyone holds
  });

  it('a bought freeze that was then used is not handed back by a stale upload', () => {
    const now = dev({
      streaks: [streak(0, '2026-07-19', ['2026-07-18'])],
      coinEvents: [seed, buy('2026-07-17T12:00:00Z')],
      xpEvents: [xp('2026-07-17T10:00:00Z', 30), xp('2026-07-19T10:00:00Z', 30)],
    });
    const stale = dev({ streaks: [streak(1)], coinEvents: [seed, buy('2026-07-17T12:00:00Z')], xpEvents: [xp('2026-07-17T10:00:00Z', 30)] });
    for (const m of [mergeBackups(now, stale), mergeBackups(stale, now)]) {
      expect(owned(m)).toBe(0);
      expect((m.data.streaks[0] as S).freezeUsedOn).toEqual(['2026-07-18']);
    }
  });

  it('a count both sides already agree on is kept even when the ledgers cannot explain it', () => {
    const a = dev({ streaks: [streak(2)] });
    expect(owned(mergeBackups(a, dev({ streaks: [streak(2)] })))).toBe(2);
  });
});
