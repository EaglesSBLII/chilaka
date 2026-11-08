// Shared contract + helpers for the game components.
import { useCallback, useRef, useState } from 'react';
import type { GameItem, ItemOutcome, RoundResult } from '../../engine/games';
import type { ScriptMode } from '../../engine/types';
import { useApp } from '../../store';

export interface GameProps {
  /** the phrases of this round (already deduplicated and shuffled) */
  items: GameItem[];
  seed: string;
  /** rounds the learner has played before, for difficulty ramps */
  roundsPlayed: number;
  onFinish(result: RoundResult): void;
}

/** The learner's script preference (games follow the lesson setting). */
export function useScriptMode(): ScriptMode {
  return useApp((s) => s.profile?.scriptMode ?? 'roman+telugu');
}

/** Telugu + roman for a tile, honouring the script mode. */
export function TileText({
  item,
  scriptMode,
  big = false,
  small = false,
  align = 'center',
}: {
  item: GameItem;
  scriptMode: ScriptMode;
  big?: boolean;
  /** narrow tiles (memory cards): smaller type that wraps instead of overflowing */
  small?: boolean;
  align?: 'center' | 'start';
}) {
  const items = align === 'start' ? 'items-start text-left' : 'items-center text-center';
  const wrap = 'max-w-full break-words [overflow-wrap:anywhere]';
  const roman = big ? 'text-xl' : small ? 'text-sm' : 'text-lg';
  const teBig = big ? 'text-3xl' : small ? 'text-xl' : 'text-2xl';
  const teSmall = big ? 'text-xl' : small ? 'text-sm' : 'text-base';
  if (scriptMode === 'roman') return <span className={`${roman} ${wrap} font-extrabold`}>{item.roman}</span>;
  if (scriptMode === 'telugu') {
    return (
      <span className={`flex max-w-full flex-col ${items} leading-tight`}>
        <span className={`te-script ${teBig} ${wrap} font-extrabold`}>{item.te}</span>
        <span className={`text-xs ${wrap} font-semibold text-ink-soft`}>{item.roman}</span>
      </span>
    );
  }
  return (
    <span className={`flex max-w-full flex-col ${items} leading-tight`}>
      <span className={`${roman} ${wrap} font-extrabold`}>{item.roman}</span>
      <span className={`te-script ${teSmall} ${wrap} text-ink-soft`}>{item.te}</span>
    </span>
  );
}

/**
 * Keeps the book on a round: the first answer for each phrase decides
 * `firstTry`, a later right answer still counts as solved. Lives in a ref so
 * rapid taps never race React state.
 */
export function useOutcomes() {
  const missed = useRef(new Set<string>());
  const solved = useRef(new Set<string>());
  const order = useRef<string[]>([]);
  const touch = (id: string) => {
    if (!order.current.includes(id)) order.current.push(id);
  };
  const miss = useCallback((id: string) => {
    touch(id);
    missed.current.add(id);
  }, []);
  const hit = useCallback((id: string) => {
    touch(id);
    solved.current.add(id);
  }, []);
  const list = useCallback(
    (): ItemOutcome[] =>
      order.current.map((itemId) => ({
        itemId,
        firstTry: solved.current.has(itemId) && !missed.current.has(itemId),
        solved: solved.current.has(itemId),
      })),
    [],
  );
  const wasMissed = useCallback((id: string) => missed.current.has(id), []);
  return { miss, hit, list, wasMissed };
}

/**
 * Input lock while an answer animates: taps during feedback are dropped, so a
 * double tap never answers the next prompt by accident.
 */
export function useLockout(): [boolean, (ms: number) => Promise<void>] {
  const [locked, setLocked] = useState(false);
  const lock = useCallback((ms: number) => {
    setLocked(true);
    return new Promise<void>((resolve) =>
      window.setTimeout(() => {
        setLocked(false);
        resolve();
      }, ms),
    );
  }, []);
  return [locked, lock];
}

export const pluralPhrases = (n: number) => `${n} phrase${n === 1 ? '' : 's'}`;
