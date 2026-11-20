import type { Unit } from './types';

/**
 * Unit availability: everything before the placement start section is open;
 * from there units unlock sequentially as the previous unit's lessons finish.
 * A unit the learner has already started never locks again — a later release
 * can slot a new unit in front of it (0.5.0 did, twice), and their finished
 * lessons must stay open.
 */
export function unitStatus(
  units: Unit[],
  unitId: string,
  unitProgress: Record<string, { lessonsDone: string[] } | undefined>,
  profileStartSection: number | undefined,
): 'locked' | 'active' | 'done' {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return 'locked';
  // each track unlocks independently and sequentially
  const inTrack = units.filter((u) => u.track === unit.track);
  const idx = inTrack.findIndex((u) => u.id === unitId);
  const up = unitProgress[unitId];
  const isComplete = up ? unit.lessons.every((l) => up.lessonsDone.includes(l.id)) : false;
  if (isComplete) return 'done';
  if (up && unit.lessons.some((l) => up.lessonsDone.includes(l.id))) return 'active'; // already started
  // placement start-section applies to the speaking track only
  const startSection = unit.track === 'speak' ? (profileStartSection ?? 1) : 1;
  if (unit.section < startSection) return 'active'; // pre-placement content stays open
  const prev = inTrack[idx - 1];
  if (!prev) return 'active';
  if (prev.section < startSection) return 'active'; // first unit at the start section
  const prevUp = unitProgress[prev.id];
  const prevDone = prevUp ? prev.lessons.every((l) => prevUp.lessonsDone.includes(l.id)) : false;
  return prevDone ? 'active' : 'locked';
}
