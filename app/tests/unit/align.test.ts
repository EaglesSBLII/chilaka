import { describe, expect, it } from 'vitest';
import {
  alignWords,
  scoreSpeech,
  scoreSpeechCalibrated,
  transcriptLooksUnreliable,
  SENTENCE_PASS_CREDIT,
} from '../../src/engine/speech/align';

describe('alignWords', () => {
  it('perfect match aligns 1:1', () => {
    const pairs = alignWords(['nenu', 'bagunnanu'], ['nenu', 'bagunnanu']);
    expect(pairs).toEqual([
      { target: 'nenu', said: 'nenu' },
      { target: 'bagunnanu', said: 'bagunnanu' },
    ]);
  });

  it('missed word yields null said', () => {
    const pairs = alignWords(['nenu', 'chala', 'bagunnanu'], ['nenu', 'bagunnanu']);
    expect(pairs).toContainEqual({ target: 'chala', said: null });
  });

  it('extra word yields null target', () => {
    const pairs = alignWords(['nenu', 'bagunnanu'], ['nenu', 'chala', 'bagunnanu']);
    expect(pairs).toContainEqual({ target: null, said: 'chala' });
  });

  it('similar words align as substitution, not gap pair', () => {
    const pairs = alignWords(['miru', 'ela', 'unnaru'], ['meru', 'ela', 'unnara']);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]).toEqual({ target: 'miru', said: 'meru' });
    expect(pairs[2]).toEqual({ target: 'unnaru', said: 'unnara' });
  });

  it('handles empty transcript', () => {
    const pairs = alignWords(['nenu'], []);
    expect(pairs).toEqual([{ target: 'nenu', said: null }]);
  });
});

describe('scoreSpeech', () => {
  it('perfect telugu transcript scores 1 and passes', () => {
    const r = scoreSpeech('నేను బాగున్నాను', 'నేను బాగున్నాను');
    expect(r.score).toBe(1);
    expect(r.pass).toBe(true);
    expect(r.words.every((w) => w.pass)).toBe(true);
  });

  it('transcript in roman vs target in telugu still matches', () => {
    const r = scoreSpeech('నేను బాగున్నాను', 'nenu bagunnanu');
    expect(r.score).toBeGreaterThan(0.95);
  });

  it('one wrong word out of four still passes sentence', () => {
    const r = scoreSpeech('nenu repu intiki vastunnanu', 'nenu repu intiki povutunnanu');
    expect(r.pass).toBe(true);
  });

  it('close-but-not-exact words pass at the lenient word bar', () => {
    // vachanu vs vacchanu style slips across every word
    const r = scoreSpeech('miru ela unnaru', 'meru ela unnara');
    expect(r.pass).toBe(true);
    expect(r.words.filter((w) => w.pass).length).toBeGreaterThanOrEqual(2);
  });

  it('a dropped tiny function word gets half credit, sentence still passes', () => {
    // recognizer heard only the second word — "em" (ఏం) is a 2-char fold
    const r = scoreSpeech('ఏం విశేషాలు', 'విశేషాలు');
    expect(r.pass).toBe(true);
  });

  it('half wrong fails the sentence', () => {
    const r = scoreSpeech('nenu bagunnanu', 'meku cheppanu');
    expect(r.pass).toBe(false);
  });

  it('empty transcript fails with zero score', () => {
    const r = scoreSpeech('nenu bagunnanu', '');
    expect(r.score).toBe(0);
    expect(r.pass).toBe(false);
    expect(r.words.every((w) => w.said === null)).toBe(true);
  });

  it('real ASR slip from the M0 spike passes', () => {
    const r = scoreSpeech('నాకు తెలుగు నేర్చుకోవాలని ఉంది', 'నాకు తెలుగు నేర్చుకోవాలి ఉంది');
    expect(r.pass).toBe(true);
  });

  it('sentence credit threshold is sane', () => {
    expect(SENTENCE_PASS_CREDIT).toBeGreaterThan(0.4);
    expect(SENTENCE_PASS_CREDIT).toBeLessThan(1);
  });
});

describe('scoreSpeechCalibrated', () => {
  it('falls back to target-only when no reference', () => {
    const r = scoreSpeechCalibrated('nenu bagunnanu', 'nenu bagunnanu');
    expect(r.pass).toBe(true);
  });

  it('passes when the learner matches what the recognizer hears in the reference', () => {
    // recognizer systematically hears "చిల్లర లేదు" as "సిల్వర్" in our own
    // reference — a learner it hears the same way must not fail
    const r = scoreSpeechCalibrated('చిల్లర లేదు', 'సిల్వర్', 'సిల్వర్');
    expect(r.pass).toBe(true);
  });

  it('does not downgrade a target-based pass', () => {
    const r = scoreSpeechCalibrated('nenu bagunnanu', 'nenu bagunnanu', 'completely different');
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it('still fails when neither target nor reference match', () => {
    const r = scoreSpeechCalibrated('nenu bagunnanu', 'poyindi', 'nenu bagunnanu');
    expect(r.pass).toBe(false);
  });
});

describe('transcriptLooksUnreliable', () => {
  const HALLUCINATION =
    'ెసల్నా వెగున. సమోనాన్నానగు. లోెన్నా పలునా ఇవదల నంల్నారాశనానానా శిట్నానానా అందినా సినాఴినానాలు. సమునాకలు సివకునాలు. సము';

  it('flags a runaway transcript of a two-word phrase', () => {
    expect(transcriptLooksUnreliable('శుభోదయం, అంకుల్!', HALLUCINATION)).toBe(true);
  });

  it('accepts an ordinary mishearing and a sibling phrase', () => {
    expect(transcriptLooksUnreliable('శుభోదయం, అంకుల్!', 'శ్వదాయమ ంగ్కుల్')).toBe(false);
    expect(transcriptLooksUnreliable('నేను బాగున్నాను.', 'నేను కూడా బాగున్నారు')).toBe(false);
    expect(transcriptLooksUnreliable('నమస్కారం', 'నమస్కారం అండి')).toBe(false);
  });

  it('never flags silence or an empty target', () => {
    expect(transcriptLooksUnreliable('నమస్కారం', '')).toBe(false);
    expect(transcriptLooksUnreliable('', HALLUCINATION)).toBe(false);
  });
});

describe('web recognizer mishearings of the first lessons', () => {
  it('a learner matching what Workers AI hears in our own clip passes via calibration', () => {
    // large-v3-turbo hears the native female clip of u01-i02 as "బాగు నను"
    const r = scoreSpeechCalibrated('నేను బాగున్నాను.', 'నేను బాగు నను', 'నేను బాగు నను');
    expect(r.pass).toBe(true);
  });
  it('the common -nu/-ru confusion still passes against the target alone', () => {
    expect(scoreSpeech('నేను బాగున్నాను.', 'నేను బాగున్నారు').pass).toBe(true);
    expect(scoreSpeech('అవును', 'అవును.').pass).toBe(true);
  });
});
