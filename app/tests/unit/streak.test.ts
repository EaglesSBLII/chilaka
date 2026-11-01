import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayDiff,
  displayCount,
  emptyStreak,
  grantFreeze,
  localDay,
  recordActivity,
  standing,
} from '../../src/engine/streak';

describe('localDay', () => {
  it('formats in the given timezone', () => {
    // 2026-07-16T03:00Z is still 2026-07-15 in Los Angeles, already 16th in Kolkata
    const d = new Date('2026-07-16T03:00:00Z');
    expect(localDay(d, 'America/Los_Angeles')).toBe('2026-07-15');
    expect(localDay(d, 'Asia/Kolkata')).toBe('2026-07-16');
  });
  it('DST spring-forward day still formats correctly', () => {
    const d = new Date('2026-03-08T10:30:00-07:00');
    expect(localDay(d, 'America/Los_Angeles')).toBe('2026-03-08');
  });
});

describe('dayDiff / addDays', () => {
  it('adjacent days', () => expect(dayDiff('2026-07-15', '2026-07-16')).toBe(1));
  it('across month boundary', () => expect(dayDiff('2026-06-30', '2026-07-01')).toBe(1));
  it('across year boundary', () => expect(dayDiff('2025-12-31', '2026-01-01')).toBe(1));
  it('across DST (calendar days immune)', () => expect(dayDiff('2026-03-07', '2026-03-09')).toBe(2));
  it('negative when reversed', () => expect(dayDiff('2026-07-16', '2026-07-15')).toBe(-1));
  it('addDays rolls months', () => expect(addDays('2026-01-31', 1)).toBe('2026-02-01'));
});

describe('recordActivity', () => {
  it('first ever activity starts streak at 1', () => {
    const r = recordActivity(emptyStreak(), '2026-07-15');
    expect(r.state.current).toBe(1);
    expect(r.state.longest).toBe(1);
    expect(r.extended).toBe(true);
    expect(r.reset).toBe(false);
  });

  it('same-day repeat activity is a no-op', () => {
    const r1 = recordActivity(emptyStreak(), '2026-07-15');
    const r2 = recordActivity(r1.state, '2026-07-15');
    expect(r2.state.current).toBe(1);
    expect(r2.extended).toBe(false);
  });

  it('consecutive days increment', () => {
    let st = recordActivity(emptyStreak(), '2026-07-15').state;
    st = recordActivity(st, '2026-07-16').state;
    st = recordActivity(st, '2026-07-17').state;
    expect(st.current).toBe(3);
    expect(st.longest).toBe(3);
  });

  it('a 1-day gap without freezes resets to 1', () => {
    let st = recordActivity(emptyStreak(), '2026-07-15').state;
    st = recordActivity(st, '2026-07-16').state;
    const r = recordActivity(st, '2026-07-18'); // missed the 17th
    expect(r.reset).toBe(true);
    expect(r.state.current).toBe(1);
    expect(r.state.longest).toBe(2);
  });

  it('a 1-day gap with a freeze preserves the streak', () => {
    let st = recordActivity(emptyStreak(), '2026-07-15').state;
    st = recordActivity(st, '2026-07-16').state;
    st = grantFreeze(st);
    const r = recordActivity(st, '2026-07-18');
    expect(r.reset).toBe(false);
    expect(r.freezesConsumed).toBe(1);
    expect(r.state.current).toBe(3);
    expect(r.state.freezesOwned).toBe(0);
    expect(r.state.freezeUsedOn).toContain('2026-07-17');
  });

  it('a 2-day gap with 2 freezes consumes both', () => {
    let st = recordActivity(emptyStreak(), '2026-07-15').state;
    st = grantFreeze(grantFreeze(st));
    const r = recordActivity(st, '2026-07-18'); // missed 16,17
    expect(r.freezesConsumed).toBe(2);
    expect(r.state.current).toBe(2);
  });

  it('a 3-day gap with only 2 freezes resets', () => {
    let st = recordActivity(emptyStreak(), '2026-07-15').state;
    st = grantFreeze(grantFreeze(st));
    const r = recordActivity(st, '2026-07-19'); // missed 16,17,18
    expect(r.reset).toBe(true);
    expect(r.state.current).toBe(1);
    // freezes are NOT consumed on reset
    expect(r.state.freezesOwned).toBe(2);
  });

  it('clock moving backwards (timezone travel) keeps streak intact', () => {
    let st = recordActivity(emptyStreak(), '2026-07-15').state;
    st = recordActivity(st, '2026-07-16').state;
    const r = recordActivity(st, '2026-07-15'); // flew west across midnight
    expect(r.state.current).toBe(2);
    expect(r.reset).toBe(false);
  });

  it('month boundary continues the streak', () => {
    let st = recordActivity(emptyStreak(), '2026-06-30').state;
    st = recordActivity(st, '2026-07-01').state;
    expect(st.current).toBe(2);
  });
});

describe('standing / displayCount', () => {
  it('none before any activity', () => {
    expect(standing(emptyStreak(), '2026-07-15')).toBe('none');
  });
  it('safe when done today', () => {
    const st = recordActivity(emptyStreak(), '2026-07-15').state;
    expect(standing(st, '2026-07-15')).toBe('safe-done-today');
  });
  it('at-risk the next day before practicing', () => {
    const st = recordActivity(emptyStreak(), '2026-07-15').state;
    expect(standing(st, '2026-07-16')).toBe('at-risk');
    expect(displayCount(st, '2026-07-16')).toBe(1);
  });
  it('covered-by-freeze when gap ≤ freezes', () => {
    const st = grantFreeze(recordActivity(emptyStreak(), '2026-07-15').state);
    expect(standing(st, '2026-07-17')).toBe('covered-by-freeze');
  });
  it('broken when gap exceeds freezes; display shows 0', () => {
    const st = recordActivity(emptyStreak(), '2026-07-15').state;
    expect(standing(st, '2026-07-18')).toBe('broken');
    expect(displayCount(st, '2026-07-18')).toBe(0);
  });
});

describe('grantFreeze cap', () => {
  it('caps at 2', () => {
    const st = grantFreeze(grantFreeze(grantFreeze(emptyStreak())));
    expect(st.freezesOwned).toBe(2);
  });
});
