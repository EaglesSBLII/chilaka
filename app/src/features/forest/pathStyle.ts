// FOREST-MAP SEAM: this file decides which path the learner sees.
//
// FOREST_MAP_ENABLED is the master switch: set it to false and the classic
// path renders for everyone and the Settings card disappears.
//
// The learner's own choice ("Forest map" / "Classic") is device-local: it is
// kept in localStorage only, never in the profile, never synced.
//
// Removal steps: docs/plans/2026-11-12-forest-map.md, section 2.

import { useSyncExternalStore } from 'react';

export const FOREST_MAP_ENABLED = true;

export type PathStyle = 'forest' | 'classic';

const KEY = 'chilaka.pathStyle';
const listeners = new Set<() => void>();

export function getPathStyle(): PathStyle {
  try {
    return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'forest';
  } catch {
    return 'forest'; // storage blocked: use the default
  }
}

export function setPathStyle(style: PathStyle): void {
  try {
    localStorage.setItem(KEY, style);
  } catch {
    // storage blocked: the choice lasts until reload
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePathStyle(): PathStyle {
  return useSyncExternalStore(subscribe, getPathStyle, () => 'forest' as PathStyle);
}
