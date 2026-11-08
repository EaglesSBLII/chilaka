// Reminder scheduling helpers — pure functions over push_subs rows.

const fmtCache = new Map();

function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

// → {day: 'YYYY-MM-DD', hour, minute, minutes} in the given IANA zone.
export function localNow(tz, dateUtc = new Date()) {
  const parts = formatter(tz).formatToParts(dateUtc);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = Number(get('hour')) % 24; // some engines print "24" at midnight
  const minute = Number(get('minute'));
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour, minute, minutes: hour * 60 + minute };
}

// Subs whose local time is in [target, target+window) and that haven't been
// sent today (local day). Each returned sub carries `localDay`.
export function dueSubs(subs, nowUtc = new Date(), windowMin = 15) {
  const out = [];
  for (const sub of subs) {
    if (!sub.enabled) continue;
    let local;
    try {
      local = localNow(sub.tz, nowUtc);
    } catch {
      continue; // bad tz → never due
    }
    const target = sub.hh * 60 + sub.mm;
    const since = (local.minutes - target + 1440) % 1440; // handles the midnight wrap
    if (since >= windowMin) continue;
    if (sub.last_sent_day === local.day) continue;
    out.push({ ...sub, localDay: local.day });
  }
  return out;
}

export function dayOfYear(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

const TITLE = 'Time for Telugu';

const COPY = [
  (n) => (n > 0 ? `Day ${n} of your streak — three minutes keeps it alive.` : null),
  () => 'Chikki saved a short lesson for you 🦜',
  () => 'Your daily goal is one lesson away.',
  () => 'Two minutes of Telugu beats zero. Ready?',
  (n) => (n > 0 ? `${n} days strong. Don't let today be the gap.` : null),
  () => 'A few review cards are waiting — quick win before dinner?',
  () => 'Same time, same habit. One lesson and you are done.',
  (n) => (n >= 7 ? `A ${n}-day streak is a real habit now. Keep the chain going.` : 'Start a chain: one lesson today.'),
];

// Habit-framed copy that rotates by day so repeats don't feel robotic.
export function pickCopy(doy, streak = 0) {
  const n = Number(streak) || 0;
  for (let i = 0; i < COPY.length; i++) {
    const body = COPY[(doy + i) % COPY.length](n);
    if (body) return { title: TITLE, body };
  }
  return { title: TITLE, body: 'One short lesson keeps the habit alive.' };
}
