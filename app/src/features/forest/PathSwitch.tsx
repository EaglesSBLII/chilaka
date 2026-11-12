// FOREST-MAP SEAM: App.tsx renders this instead of <Path /> directly. It shows
// the forest map unless the master flag is off or the learner chose "Classic"
// in Settings. The classic path is passed in untouched.

import type { ReactNode } from 'react';
import { ForestPath } from './ForestPath';
import { FOREST_MAP_ENABLED, usePathStyle } from './pathStyle';

export function PathSwitch({ classic }: { classic: ReactNode }) {
  const style = usePathStyle();
  if (FOREST_MAP_ENABLED && style === 'forest') return <ForestPath />;
  return <>{classic}</>;
}
