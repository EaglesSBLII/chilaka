// Core content + progress types shared across the whole app.

export interface Word {
  te: string;
  roman: string;
  gloss: string;
}

export interface ContentItem {
  id: string; // "u01-i01"
  te: string; // Telugu script
  roman: string; // learner transliteration ("nenu bagunnanu")
  gloss: string; // English meaning
  words: Word[]; // per-word breakdown, in order
  tags: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  distractors?: string[]; // preferred wrong-answer item ids
  note?: string; // grammar/culture tip
}

export interface Lesson {
  id: string; // "l1"
  title: string;
  itemIds: string[];
}

export interface DialogueTurn {
  speaker: string; // display name, e.g. "Vendor"
  itemId: string;
  userTurn?: boolean; // true = learner speaks/builds this line
}

export interface Dialogue {
  id: string;
  title: string;
  scene: string; // one-line scenario description
  turns: DialogueTurn[];
}

export interface Unit {
  id: string; // "u01"
  track: 'speak' | 'script';
  section: number; // 1..8 within its track
  order: number; // position within section
  title: string;
  teTitle?: string;
  cefr: string;
  register: 'standard' | 'hyderabad';
  description: string;
  items: ContentItem[];
  lessons: Lesson[];
  dialogue?: Dialogue;
}

export interface SectionMeta {
  number: number;
  title: string;
  tagline: string;
  color: string; // section theme color token
}

// ---- Exercises (generated, never authored) ----

export type ExerciseKind =
  | 'intro'
  | 'mc-te2en'
  | 'mc-en2te'
  | 'mc-audio'
  | 'wordbank'
  | 'listen-pick'
  | 'type-script'
  | 'trace'
  | 'speak'
  | 'dialogue';

export interface BaseExercise {
  kind: ExerciseKind;
  itemId: string;
}

export interface IntroExercise extends BaseExercise {
  kind: 'intro';
}

export interface ChoiceExercise extends BaseExercise {
  kind: 'mc-te2en' | 'mc-en2te' | 'mc-audio' | 'listen-pick';
  choiceIds: string[]; // item ids; correct answer == itemId
}

export interface WordbankExercise extends BaseExercise {
  kind: 'wordbank';
  tiles: string[]; // shuffled roman tiles incl. distractor tiles
}

export interface SpeakExercise extends BaseExercise {
  kind: 'speak';
}

/** Write the item in Telugu script using the system Telugu keyboard. */
export interface TypeScriptExercise extends BaseExercise {
  kind: 'type-script';
}

/** Draw the letter (or short word) by hand: over a guide, or from memory. */
export interface TraceExercise extends BaseExercise {
  kind: 'trace';
  guide: boolean;
}

export interface DialogueExercise extends BaseExercise {
  kind: 'dialogue';
  dialogueId: string;
}

export type Exercise =
  | IntroExercise
  | ChoiceExercise
  | WordbankExercise
  | TypeScriptExercise
  | TraceExercise
  | SpeakExercise
  | DialogueExercise;

// ---- Progress / gamification ----

export type Difficulty = 'relaxed' | 'standard' | 'intense';
export type ScriptMode = 'roman' | 'roman+telugu' | 'telugu';

export interface StreakState {
  current: number;
  longest: number;
  lastActiveDay: string | null; // local 'YYYY-MM-DD'
  freezesOwned: number;
  freezeUsedOn: string[]; // days covered by a freeze
}

export type StreakStanding = 'none' | 'safe-done-today' | 'at-risk' | 'covered-by-freeze' | 'broken';

export interface SpeakWordResult {
  target: string; // target word (roman display form)
  said: string | null; // aligned word from the transcript, null = missed
  similarity: number; // 0..1
  pass: boolean;
}

export interface SpeakResult {
  transcriptRoman: string;
  words: SpeakWordResult[];
  score: number; // 0..1 mean similarity
  pass: boolean;
}
