// Lesson 1 ("Hello, how are you?") speaking grades: the four sentences must pass
// when heard correctly, tolerate the recognizer's usual slips, and fail clearly
// different sentences — so the first thing a learner says is graded fairly.
import { describe, expect, it } from 'vitest';
import { scoreSpeechCalibrated } from '../../src/engine/speech/align';
import refs from '../../src/content/reference-transcripts.json';

const REFS = refs as Record<string, string>;
const LESSON1 = [
  { id: 'u01-i01', te: 'మీరు ఎలా ఉన్నారు?' },
  { id: 'u01-i02', te: 'నేను బాగున్నాను.' },
  { id: 'u01-i03', te: 'మీరు బాగున్నారా?' },
  { id: 'u01-i04', te: 'నేను కూడా బాగున్నాను.' },
];

describe('lesson 1 speaking grades', () => {
  it('has a reference transcript for every lesson-1 sentence', () => {
    for (const it of LESSON1) expect(REFS[it.id], it.id).toBeTruthy();
  });

  it('passes each sentence when heard exactly (with or without punctuation)', () => {
    for (const it of LESSON1) {
      expect(scoreSpeechCalibrated(it.te, it.te, REFS[it.id]).pass, it.id).toBe(true);
      expect(scoreSpeechCalibrated(it.te, REFS[it.id], REFS[it.id]).pass, it.id).toBe(true);
      expect(scoreSpeechCalibrated(it.te, it.te.replace(/[?.]/g, ''), REFS[it.id]).pass, it.id).toBe(true);
    }
  });

  it('passes when heard in romanised form', () => {
    expect(scoreSpeechCalibrated('మీరు ఎలా ఉన్నారు?', 'meeru ela unnaru', REFS['u01-i01']).pass).toBe(true);
    expect(scoreSpeechCalibrated('నేను బాగున్నాను.', 'nenu bagunnanu', REFS['u01-i02']).pass).toBe(true);
    expect(scoreSpeechCalibrated('నేను కూడా బాగున్నాను.', 'nenu kuda bagunnanu', REFS['u01-i04']).pass).toBe(true);
  });

  it('forgives one slurred word but not a different sentence', () => {
    // one word off (ఉన్నారు → ఉన్నాడు) still passes on credit
    expect(scoreSpeechCalibrated('మీరు ఎలా ఉన్నారు?', 'మీరు ఎలా ఉన్నాడు', REFS['u01-i01']).pass).toBe(true);
    // a different lesson-1 sentence must not pass as this one
    expect(scoreSpeechCalibrated('మీరు ఎలా ఉన్నారు?', 'నేను బాగున్నాను', REFS['u01-i01']).pass).toBe(false);
    // silence / nothing heard fails
    expect(scoreSpeechCalibrated('నేను బాగున్నాను.', '', REFS['u01-i02']).pass).toBe(false);
  });
});
