// Zod schema for authored curriculum JSON. The authored shape stores NO
// romanization — roman is derived from the Telugu script via teluguToRoman
// at load time (single source of truth; guarantees tiles/typing/speech all
// agree). `romanOverride` exists for loanwords the transliterator can't know.

import { z } from 'zod';

const TELUGU_RE = /^[ఀ-౿\s.,!?'"‘’“”\-–0-9]+$/u;

export const authoredWordSchema = z.object({
  te: z.string().min(1).regex(TELUGU_RE, 'word must be Telugu script'),
  gloss: z.string().min(1),
  romanOverride: z.string().optional(),
});

export const authoredItemSchema = z.object({
  id: z.string().regex(/^u\d{2}-i\d{2}$/),
  te: z.string().min(1).regex(TELUGU_RE, 'sentence must be Telugu script'),
  /** optional TTS text override (e.g. a letter followed by an example word) */
  audioTe: z.string().regex(TELUGU_RE).optional(),
  gloss: z.string().min(1),
  words: z.array(authoredWordSchema).min(1),
  tags: z.array(z.string()).default([]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  distractors: z.array(z.string()).optional(),
  note: z.string().optional(),
  romanOverride: z.string().optional(),
});

export const authoredLessonSchema = z.object({
  id: z.string().regex(/^l\d$/),
  title: z.string().min(1),
  itemIds: z.array(z.string()).min(2).max(8),
});

export const authoredDialogueSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  scene: z.string().min(1),
  turns: z
    .array(
      z.object({
        speaker: z.string().min(1),
        itemId: z.string(),
        userTurn: z.boolean().optional(),
      }),
    )
    .min(4),
});

export const authoredUnitSchema = z.object({
  id: z.string().regex(/^u\d{2}$/),
  /** 'speak' = the main conversational course; 'script' = reading & writing */
  track: z.enum(['speak', 'script']).default('speak'),
  section: z.number().int().min(0).max(8),
  order: z.number().int().min(1).max(8),
  title: z.string().min(1),
  teTitle: z.string().optional(),
  cefr: z.string(),
  register: z.enum(['standard', 'hyderabad']),
  description: z.string().min(1),
  items: z.array(authoredItemSchema).min(6).max(24),
  lessons: z.array(authoredLessonSchema).min(2).max(6),
  dialogue: authoredDialogueSchema.optional(),
});

export type AuthoredUnit = z.infer<typeof authoredUnitSchema>;
export type AuthoredItem = z.infer<typeof authoredItemSchema>;
