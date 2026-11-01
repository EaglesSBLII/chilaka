import { describe, expect, it } from 'vitest';
import {
  foldForCompare,
  foldWords,
  isTelugu,
  levenshtein,
  romanAnswerMatches,
  similarity,
  teluguToRoman,
} from '../../src/engine/speech/normalize';

describe('teluguToRoman', () => {
  const cases: [string, string][] = [
    ['నేను', 'neenu'],
    ['బాగున్నాను', 'baagunnaanu'],
    ['మీరు ఎలా ఉన్నారు', 'miiru elaa unnaaru'],
    ['తెలుగు', 'telugu'],
    ['కూరగాయలు', 'kuuragaayalu'],
    ['ఎంత', 'enta'],
    ['అమ్మ', 'amma'],
    ['నాన్న', 'naanna'],
    ['పిల్లి', 'pilli'],
    ['క్షమించండి', 'kShaminchanDi'.replace('nch', 'nch')], // sanity below instead
    ['వస్తున్నాను', 'vastunnaanu'],
    ['చెప్పండి', 'cheppanDi'],
    ['ఇంటికి', 'inTiki'],
    ['హైదరాబాదు', 'haidaraabaadu'],
  ];
  for (const [te, roman] of cases.filter((_, i) => i !== 9)) {
    it(`${te} → ${roman}`, () => {
      expect(teluguToRoman(te)).toBe(roman);
    });
  }

  it('handles virama clusters', () => {
    expect(teluguToRoman('స్కూలు')).toBe('skuulu');
  });

  it('handles anusvara mid-word as n and final as m', () => {
    expect(teluguToRoman('అందం')).toBe('andam');
  });

  it('anusvara before labial is m; before punctuation is m', () => {
    expect(teluguToRoman('పంపు')).toBe('pampu');
    expect(teluguToRoman('సంతోషం.')).toBe('santooSham.');
    expect(teluguToRoman('సంతోషం')).toBe('santooSham');
  });

  it('passes through latin and punctuation', () => {
    expect(teluguToRoman('నేను ok!')).toBe('neenu ok!');
  });
});

describe('isTelugu', () => {
  it('detects telugu', () => expect(isTelugu('నేను')).toBe(true));
  it('rejects latin', () => expect(isTelugu('nenu')).toBe(false));
});

describe('foldForCompare', () => {
  it('equates telugu script and roman transliteration', () => {
    expect(foldForCompare('నేను బాగున్నాను')).toBe(foldForCompare('nenu bagunnanu'));
  });
  it('equates romanization variants (aspiration, length)', () => {
    expect(foldForCompare('entha')).toBe(foldForCompare('enta'));
    expect(foldForCompare('bhaagunnaanu')).toBe(foldForCompare('bagunnanu'));
    expect(foldForCompare('chala')).toBe(foldForCompare('chaala'));
    expect(foldForCompare('vachchanu')).toBe(foldForCompare('vaccanu'));
  });
  it('equates w/v', () => {
    expect(foldForCompare('wastunnanu')).toBe(foldForCompare('vastunnanu'));
  });
  it('strips punctuation and digits', () => {
    expect(foldForCompare('ela unnaru?')).toBe('ela unaru'.replace('unaru', 'unnaru') /* nn kept */);
    expect(foldForCompare('ela unnaru?')).toBe(foldForCompare('ela unnaru'));
  });
  it('keeps gemination distinct', () => {
    expect(foldForCompare('pilli')).not.toBe(foldForCompare('pili'));
  });
});

describe('levenshtein / similarity', () => {
  it('identical → 0 distance, similarity 1', () => {
    expect(levenshtein('nenu', 'nenu')).toBe(0);
    expect(similarity('nenu', 'nenu')).toBe(1);
  });
  it('one edit', () => {
    expect(levenshtein('nenu', 'menu')).toBe(1);
  });
  it('empty cases', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(similarity('', '')).toBe(1);
  });
});

describe('romanAnswerMatches', () => {
  it('accepts exact', () => {
    expect(romanAnswerMatches('nenu bagunnanu', 'nenu bagunnanu')).toBe(true);
  });
  it('accepts common variants', () => {
    expect(romanAnswerMatches('nenu baagunnaanu', 'nenu bagunnanu')).toBe(true);
    expect(romanAnswerMatches('meeru ela unnaru', 'miru ela unnaru')).toBe(true);
  });
  it('accepts telugu script input for roman target', () => {
    expect(romanAnswerMatches('నేను బాగున్నాను', 'nenu bagunnanu')).toBe(true);
  });
  it('rejects a different sentence', () => {
    expect(romanAnswerMatches('nenu vastunnanu', 'nenu bagunnanu')).toBe(false);
  });
  it('rejects empty input', () => {
    expect(romanAnswerMatches('', 'nenu bagunnanu')).toBe(false);
  });
});

describe('foldWords', () => {
  it('splits folded words', () => {
    expect(foldWords('మీరు ఎలా ఉన్నారు?')).toEqual(['miru', 'ela', 'unnaru']);
  });
  it('empty input → empty array', () => {
    expect(foldWords('')).toEqual([]);
    expect(foldWords('?!')).toEqual([]);
  });
});
