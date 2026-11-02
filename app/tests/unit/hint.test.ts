import { describe, expect, it } from 'vitest';
import { asrHint, asrHintFor, HINT_MAX_PHRASES } from '../../src/engine/speech/hint';
import { allUnits } from '../../src/content/load';

describe('asrHint', () => {
  const u01 = allUnits().find((u) => u.id === 'u01')!;
  const target = u01.items[0];

  it('never contains the sentence being graded', () => {
    const hint = asrHintFor(target, u01);
    expect(hint.length).toBeGreaterThan(0);
    expect(hint).not.toContain(target.te);
  });

  it('is built from the unit\'s other phrases, nearest first', () => {
    const hint = asrHintFor(u01.items[2], u01);
    expect(hint.startsWith(u01.items[1].te) || hint.startsWith(u01.items[3].te)).toBe(true);
  });

  it('stays bounded', () => {
    const big = allUnits().reduce((a, b) => (a.items.length > b.items.length ? a : b));
    const hint = asrHint(big.items[0], big.items);
    expect(hint.split(' ').length).toBeLessThanOrEqual(HINT_MAX_PHRASES * 8);
    expect(hint.length).toBeLessThanOrEqual(600);
  });

  it('is empty without a unit', () => {
    expect(asrHintFor(target, undefined)).toBe('');
  });
});
