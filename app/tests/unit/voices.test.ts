import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE, genderOf, otherVoice, voiceForSpeaker } from '../../src/content/voices';
import { allUnits } from '../../src/content/load';

describe('voices', () => {
  it('female is the default and the voices alternate', () => {
    expect(DEFAULT_VOICE).toBe('female');
    expect(otherVoice('female')).toBe('male');
    expect(otherVoice('male')).toBe('female');
  });

  it('named characters keep their gender regardless of the chosen voice', () => {
    expect(voiceForSpeaker('Uncle', 'female')).toBe('male');
    expect(voiceForSpeaker('Amma', 'male')).toBe('female');
    expect(voiceForSpeaker('Clerk', 'male')).toBe('male');
    expect(voiceForSpeaker('Clerk', 'female')).toBe('female');
  });

  it('every dialogue speaker resolves to a voice', () => {
    for (const u of allUnits()) {
      for (const t of u.dialogue?.turns ?? []) {
        expect(['female', 'male']).toContain(voiceForSpeaker(t.speaker, 'female'));
        const g = genderOf(t.speaker);
        if (g === 'm') expect(voiceForSpeaker(t.speaker, 'female')).toBe('male');
      }
    }
  });
});
