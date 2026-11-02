// Loads authored unit JSON into runtime Unit objects, deriving romanization
// from the Telugu script so display, tiles, typing and speech all agree.

import type { ContentItem, Unit, Word } from '../engine/types';
import { teluguToRoman } from '../engine/speech/normalize';
import { authoredUnitSchema, type AuthoredUnit } from './schema';
import type { VoiceId } from './voices';

export function romanize(te: string, override?: string): string {
  if (override) return override;
  return teluguToRoman(te).toLowerCase();
}

export function loadUnit(raw: unknown): Unit {
  const a: AuthoredUnit = authoredUnitSchema.parse(raw);
  const items: ContentItem[] = a.items.map((it) => ({
    id: it.id,
    te: it.te,
    roman: romanize(it.te, it.romanOverride),
    gloss: it.gloss,
    words: it.words.map(
      (w): Word => ({ te: w.te, roman: romanize(w.te, w.romanOverride), gloss: w.gloss }),
    ),
    tags: it.tags,
    difficulty: it.difficulty,
    distractors: it.distractors,
    note: it.note,
  }));
  return {
    id: a.id,
    track: a.track,
    section: a.section,
    order: a.order,
    title: a.title,
    teTitle: a.teTitle,
    cefr: a.cefr,
    register: a.register,
    description: a.description,
    items,
    lessons: a.lessons,
    dialogue: a.dialogue,
  };
}

// Eagerly import every authored unit. Vite inlines these into the bundle —
// content is small text; audio stays external.
const unitModules = import.meta.glob('../../content/units/*.json', { eager: true }) as Record<
  string,
  { default: unknown }
>;

let cache: Unit[] | null = null;

export function allUnits(): Unit[] {
  if (!cache) {
    cache = Object.entries(unitModules)
      .map(([, mod]) => loadUnit(mod.default))
      .sort(
        (x, y) =>
          (x.track === 'script' ? 1 : 0) - (y.track === 'script' ? 1 : 0) ||
          x.section - y.section ||
          x.order - y.order,
      );
  }
  return cache;
}

export function unitById(id: string): Unit | undefined {
  return allUnits().find((u) => u.id === id);
}

export function allItems(): ContentItem[] {
  return allUnits().flatMap((u) => u.items);
}

export function trackUnits(track: 'speak' | 'script'): Unit[] {
  return allUnits().filter((u) => u.track === track);
}

export function trackItems(track: 'speak' | 'script'): ContentItem[] {
  return trackUnits(track).flatMap((u) => u.items);
}

export function itemById(id: string): ContentItem | undefined {
  const m = itemMap();
  return m.get(id);
}

let itemMapCache: Map<string, ContentItem> | null = null;
function itemMap(): Map<string, ContentItem> {
  if (!itemMapCache) {
    itemMapCache = new Map(allItems().map((i) => [i.id, i]));
  }
  return itemMapCache;
}

export function audioFileFor(itemId: string, voice: VoiceId): string {
  return `audio/v-${voice}/${itemId}.m4a`;
}
