import { LOCKED_NODE } from '../../devMode';
// Forest map state rules. Pure functions (unit tested) that mirror the classic
// path's rules for what each lesson looks like and add "where is Chikki".

import type { Side } from './layout';

export type NodeState = 'done' | 'current' | 'replayable' | 'locked';
export type UnitStatus = 'locked' | 'active' | 'done';

interface UnitLike {
  id: string;
  section: number;
  lessons: { id: string }[];
}

/**
 * Same rules as UnitBlock in the classic Path.tsx: a locked unit locks every
 * lesson; done lessons are done; units before a placed-ahead start section are
 * open for review but never "current"; otherwise the first incomplete lesson
 * is current and the rest are locked.
 */
export function lessonStates(unit: UnitLike, status: UnitStatus, lessonsDone: readonly string[], startSection: number): NodeState[] {
  const done = new Set(lessonsDone);
  const firstIncomplete = unit.lessons.findIndex((l) => !done.has(l.id));
  return unit.lessons.map((l, i) => {
    if (status === 'locked') return LOCKED_NODE;
    if (done.has(l.id)) return 'done';
    if (unit.section < startSection) return 'replayable';
    if (i === firstIncomplete) return 'current';
    return LOCKED_NODE;
  });
}

export interface PerchRef {
  unitId: string;
  lessonId: string;
}

/** The lesson Chikki sits on: the first one in the "current" state. */
export function findCurrent(units: readonly { id: string; lessons: { id: string }[] }[], states: ReadonlyMap<string, NodeState[]>): PerchRef | null {
  for (const u of units) {
    const st = states.get(u.id);
    if (!st) continue;
    const i = st.indexOf('current');
    if (i >= 0) return { unitId: u.id, lessonId: u.lessons[i].id };
  }
  return null;
}

/**
 * Should Chikki fly in? Yes when the perch we last showed as current has since
 * been completed and the current perch is a different one. Returns the perch
 * to fly from, or null to simply appear.
 */
export function flightOrigin(prev: PerchRef | null, now: PerchRef | null, isDone: (ref: PerchRef) => boolean): PerchRef | null {
  if (!prev || !now) return null;
  if (prev.unitId === now.unitId && prev.lessonId === now.lessonId) return null;
  return isDone(prev) ? prev : null;
}

/** The side the next unit starts on so the zigzag carries on across units. */
export function nextStartSide(startSide: Side, nodeCount: number): Side {
  if (nodeCount % 2 === 0) return startSide;
  return startSide === 'L' ? 'R' : 'L';
}
