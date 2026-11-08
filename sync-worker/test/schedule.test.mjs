import test from 'node:test';
import assert from 'node:assert/strict';
import { localNow, dueSubs, pickCopy, dayOfYear, isValidTimeZone } from '../src/lib/schedule.js';

// 2026-03-10T14:30:00Z = 20:00 IST (Asia/Kolkata, +5:30), 07:30 PDT (America/Los_Angeles, -7; DST began Mar 8)
const NOW = new Date('2026-03-10T14:30:00Z');

test('localNow resolves hour/minute/day per zone', () => {
  assert.deepEqual(localNow('Asia/Kolkata', NOW), { day: '2026-03-10', hour: 20, minute: 0, minutes: 1200 });
  assert.deepEqual(localNow('America/Los_Angeles', NOW), { day: '2026-03-10', hour: 7, minute: 30, minutes: 450 });
  // day rollover: 19:30 UTC is already the 11th in Auckland (+13 in March)
  assert.equal(localNow('Pacific/Auckland', new Date('2026-03-10T19:30:00Z')).day, '2026-03-11');
  assert.equal(localNow('UTC', new Date('2026-03-10T00:05:00Z')).hour, 0);
});

test('isValidTimeZone', () => {
  assert.equal(isValidTimeZone('Asia/Kolkata'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
});

test('dueSubs picks the right subs across zones and windows', () => {
  const base = { enabled: 1, last_sent_day: null };
  const subs = [
    { id: 1, ...base, tz: 'Asia/Kolkata', hh: 20, mm: 0 }, // exactly on target
    { id: 2, ...base, tz: 'Asia/Kolkata', hh: 19, mm: 50 }, // 10 min ago → still in window
    { id: 3, ...base, tz: 'Asia/Kolkata', hh: 19, mm: 40 }, // 20 min ago → missed
    { id: 4, ...base, tz: 'Asia/Kolkata', hh: 20, mm: 5 }, // not yet
    { id: 5, ...base, tz: 'America/Los_Angeles', hh: 7, mm: 30 }, // due in LA
    { id: 6, ...base, tz: 'America/Los_Angeles', hh: 20, mm: 0 }, // not in LA
    { id: 7, ...base, tz: 'Asia/Kolkata', hh: 20, mm: 0, last_sent_day: '2026-03-10' }, // already sent today
    { id: 8, ...base, tz: 'Asia/Kolkata', hh: 20, mm: 0, last_sent_day: '2026-03-09' }, // sent yesterday → due
    { id: 9, ...base, tz: 'Asia/Kolkata', hh: 20, mm: 0, enabled: 0 },
    { id: 10, ...base, tz: 'Nowhere/Land', hh: 20, mm: 0 },
  ];
  const due = dueSubs(subs, NOW, 15);
  assert.deepEqual(due.map((s) => s.id), [1, 2, 5, 8]);
  assert.equal(due[0].localDay, '2026-03-10');
  assert.equal(due[2].localDay, '2026-03-10');
  assert.deepEqual(dueSubs(subs, NOW, 30).map((s) => s.id), [1, 2, 3, 5, 8]);
});

test('dueSubs handles the midnight wrap', () => {
  const sub = { id: 1, enabled: 1, last_sent_day: null, tz: 'UTC', hh: 23, mm: 55 };
  const due = dueSubs([sub], new Date('2026-03-11T00:05:00Z'), 15);
  assert.equal(due.length, 1);
  assert.equal(due[0].localDay, '2026-03-11');
});

test('pickCopy rotates and always returns a title/body', () => {
  const seen = new Set();
  for (let d = 0; d < 16; d++) {
    const c = pickCopy(d, 12);
    assert.equal(c.title, 'Time for Telugu');
    assert.ok(c.body.length > 10);
    seen.add(c.body);
  }
  assert.ok(seen.size >= 6);
  assert.match(pickCopy(0, 12).body, /Day 12/);
  assert.doesNotMatch(pickCopy(0, 0).body, /Day 0|undefined/);
  assert.equal(dayOfYear(new Date('2026-01-01T12:00:00Z')), 1);
  assert.equal(dayOfYear(new Date('2026-12-31T12:00:00Z')), 365);
});
