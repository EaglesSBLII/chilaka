// Context for the speech recognizer. Whisper decodes with a text prompt that
// biases it toward the words it is about to hear — the same trick dictation
// engines use with your contacts and recent messages. We prime it with the
// OTHER phrases in the current unit: same vocabulary and register, but never
// the sentence being graded, so a pass still means the learner was understood.

import type { ContentItem, Unit } from '../types';

export const HINT_MAX_PHRASES = 12;
export const HINT_MAX_CHARS = 600;

/** Build the recognizer prompt from the unit's other phrases. */
export function asrHint(target: ContentItem, siblings: readonly ContentItem[]): string {
  const out: string[] = [];
  let chars = 0;
  for (const it of siblings) {
    if (it.id === target.id) continue;
    const te = it.te.trim();
    if (!te || te === target.te.trim()) continue;
    if (out.length >= HINT_MAX_PHRASES || chars + te.length + 1 > HINT_MAX_CHARS) break;
    out.push(te);
    chars += te.length + 1;
  }
  return out.join(' ');
}

/** Hint for an item, given the unit it belongs to (null when unknown). */
export function asrHintFor(item: ContentItem, unit: Unit | undefined): string {
  if (!unit) return '';
  // phrases nearest the target first — they share the lesson's vocabulary
  const idx = unit.items.findIndex((it) => it.id === item.id);
  const ordered = [...unit.items].sort(
    (a, b) => Math.abs(unit.items.indexOf(a) - idx) - Math.abs(unit.items.indexOf(b) - idx),
  );
  return asrHint(item, ordered);
}
