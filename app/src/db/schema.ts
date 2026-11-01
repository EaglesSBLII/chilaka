// Dexie (IndexedDB) persistence. Every mutation goes through liveStore
// actions; this module only defines tables and plain row types.

import Dexie, { type EntityTable } from 'dexie';
import type { Difficulty, ScriptMode, StreakState } from '../engine/types';
import type { StoredCard } from '../engine/srs';

export interface ProfileRow {
  id: string; // 'main'
  name: string;
  createdAt: string;
  onboarded: boolean;
  placementDone: boolean;
  startSection: number;
  difficulty: Difficulty;
  scriptMode: ScriptMode;
  timezone: string;
  soundOn: boolean;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface UnitProgressRow {
  unitId: string;
  lessonsDone: string[]; // lesson ids completed at least once
  dialogueDone: boolean;
  completedAt: string | null;
}

export interface LessonProgressRow {
  id: string; // `${unitId}:${lessonId}`
  attempts: number;
  bestPct: number; // 0..1
  lastCompletedAt: string | null;
  xpEarned: number;
}

export interface StreakRow extends StreakState {
  id: string; // 'main'
}

export interface XpEventRow {
  id?: number;
  ts: string;
  amount: number;
  source: 'lesson' | 'review' | 'speak' | 'dialogue' | 'placement' | 'bonus';
  refId: string;
  day: string; // local YYYY-MM-DD at time of earning
}

export interface ReminderRow {
  id?: number;
  hh: number;
  mm: number;
  enabled: boolean;
  label: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface MusicTrackRow {
  id?: number;
  name: string;
  blob: Blob;
  addedAt: string;
}

export class ChilakaDB extends Dexie {
  profile!: EntityTable<ProfileRow, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  unitProgress!: EntityTable<UnitProgressRow, 'unitId'>;
  lessonProgress!: EntityTable<LessonProgressRow, 'id'>;
  srsCards!: EntityTable<StoredCard, 'id'>;
  streaks!: EntityTable<StreakRow, 'id'>;
  xpEvents!: EntityTable<XpEventRow, 'id'>;
  reminders!: EntityTable<ReminderRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  musicTracks!: EntityTable<MusicTrackRow, 'id'>;

  constructor(name = 'chilaka') {
    super(name);
    this.version(1).stores({
      profile: 'id',
      settings: 'key',
      unitProgress: 'unitId',
      lessonProgress: 'id',
      srsCards: 'id, due',
      streaks: 'id',
      xpEvents: '++id, day, ts',
      reminders: '++id',
      meta: 'key',
    });
    // v2: background-music tracks (audio blobs stay local; excluded from backups)
    this.version(2).stores({
      musicTracks: '++id',
    });
  }
}

export const db = new ChilakaDB();

export const SCHEMA_VERSION = 2;
