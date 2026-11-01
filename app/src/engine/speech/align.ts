// Word-level alignment between a target sentence and an ASR transcript.
// Needleman–Wunsch over word sequences with substitution cost driven by
// character-level similarity of folded words.
//
// Scoring philosophy: the learner should pass when a human listener would say
// "yes, that's the sentence". The on-device recognizer under-hears short
// function words and English loanwords, so scoring gives partial credit,
// forgives dropped tiny words, and can calibrate against what the recognizer
// hears in OUR OWN reference recording of the same sentence.

import type { SpeakResult, SpeakWordResult } from '../types';
import { foldWords, similarity } from './normalize';

export const WORD_PASS_THRESHOLD = 0.65;
export const WORD_PARTIAL_THRESHOLD = 0.45;
export const SENTENCE_PASS_CREDIT = 0.6;

interface AlignedPair {
  target: string | null; // null = extra word said
  said: string | null; // null = target word missed
}

/** Align two word arrays; returns pairs in target order (plus insertions). */
export function alignWords(target: string[], said: string[]): AlignedPair[] {
  const m = target.length;
  const n = said.length;
  const GAP = 1.0;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) dp[i][0] = i * GAP;
  for (let j = 1; j <= n; j++) dp[0][j] = j * GAP;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = dp[i - 1][j - 1] + (1 - similarity(target[i - 1], said[j - 1])) * 2;
      dp[i][j] = Math.min(sub, dp[i - 1][j] + GAP, dp[i][j - 1] + GAP);
    }
  }
  const pairs: AlignedPair[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sub = dp[i - 1][j - 1] + (1 - similarity(target[i - 1], said[j - 1])) * 2;
      if (Math.abs(dp[i][j] - sub) < 1e-9) {
        pairs.push({ target: target[i - 1], said: said[j - 1] });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + GAP)) < 1e-9) {
      pairs.push({ target: target[i - 1], said: null });
      i--;
    } else {
      pairs.push({ target: null, said: said[j - 1] });
      j--;
    }
  }
  pairs.reverse();
  return pairs;
}

/** Credit a word contributes toward the sentence pass (0, 0.5, or 1). */
function wordCredit(w: SpeakWordResult): number {
  if (w.pass) return 1;
  if (w.similarity >= WORD_PARTIAL_THRESHOLD) return 0.5;
  // recognizers routinely drop tiny function words (ఏం, ఆ, ఈ...) — half
  // credit instead of a red mark when such a word goes unheard
  if (w.said === null && w.target.length <= 2) return 0.5;
  return 0;
}

/** Score a spoken attempt against one expected sentence. */
export function scoreSpeech(targetSentence: string, transcript: string): SpeakResult {
  const targetFolded = foldWords(targetSentence);
  const saidFolded = foldWords(transcript);
  const pairs = alignWords(targetFolded, saidFolded);

  const words: SpeakWordResult[] = [];
  for (const p of pairs) {
    if (p.target === null) continue; // extra word said — ignore, be lenient
    const sim = p.said === null ? 0 : similarity(p.target, p.said);
    words.push({
      target: p.target,
      said: p.said,
      similarity: sim,
      pass: sim >= WORD_PASS_THRESHOLD,
    });
  }
  const score = words.length === 0 ? 0 : words.reduce((s, w) => s + w.similarity, 0) / words.length;
  const credit = words.length === 0 ? 0 : words.reduce((s, w) => s + wordCredit(w), 0) / words.length;
  return {
    transcriptRoman: saidFolded.join(' '),
    words,
    score,
    pass: credit >= SENTENCE_PASS_CREDIT,
  };
}

/**
 * Score with calibration: if the recognizer mishears even OUR studio reference
 * recording of this sentence (referenceTranscript = what it heard there), the
 * learner matching that same hearing counts as correct. Word chips always show
 * the target-based view; pass/score take the better of the two.
 */
export function scoreSpeechCalibrated(
  targetSentence: string,
  transcript: string,
  referenceTranscript?: string | null,
): SpeakResult {
  const vsTarget = scoreSpeech(targetSentence, transcript);
  if (!referenceTranscript || vsTarget.pass) return vsTarget;
  const vsRef = scoreSpeech(referenceTranscript, transcript);
  if (vsRef.pass || vsRef.score > vsTarget.score) {
    return {
      ...vsTarget,
      score: Math.max(vsTarget.score, vsRef.score),
      pass: vsTarget.pass || vsRef.pass,
    };
  }
  return vsTarget;
}
