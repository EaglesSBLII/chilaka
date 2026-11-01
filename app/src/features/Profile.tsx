// Profile: level, streak, stats, weekly XP chart, December goal countdown.

import { useEffect, useState } from 'react';
import { useApp, useStreakStanding } from '../store';
import { db } from '../db/schema';
import { levelForXp, nextLevel } from '../engine/xp';
import { allUnits } from '../content/load';
import { localDay, addDays } from '../engine/streak';
import { Card, ProgressBar } from '../components/ui';
import { Mascot } from '../components/Mascot';

export function Profile() {
  const profile = useApp((s) => s.profile);
  const totalXp = useApp((s) => s.totalXp);
  const streak = useApp((s) => s.streak);
  const unitProgress = useApp((s) => s.unitProgress);
  const srsCards = useApp((s) => s.srsCards);
  const { count } = useStreakStanding();
  const [week, setWeek] = useState<{ day: string; xp: number }[]>([]);

  const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDay(new Date(), tz);

  useEffect(() => {
    void (async () => {
      const events = await db.xpEvents.toArray();
      const days: { day: string; xp: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        days.push({ day: d, xp: events.filter((e) => e.day === d).reduce((s, e) => s + e.amount, 0) });
      }
      setWeek(days);
    })();
  }, [today]);

  const level = levelForXp(totalXp);
  const next = nextLevel(totalXp);
  const unitsDone = allUnits().filter((u) => {
    const up = unitProgress[u.id];
    return up && u.lessons.every((l) => up.lessonsDone.includes(l.id));
  }).length;
  const phrasesLearned = Object.keys(srsCards).length;
  const daysToGoal = Math.max(0, Math.round((Date.UTC(2026, 11, 31) - Date.parse(`${today}T00:00:00Z`)) / 86400000));
  const maxWeek = Math.max(35, ...week.map((w) => w.xp));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Mascot pose="cheer" size={90} />
        <div>
          <h2 className="text-2xl font-extrabold">{profile?.name ?? 'Friend'}</h2>
          <p className="font-bold text-teal">
            Level {level.level}: {level.name} · <span className="te-script">{level.teName}</span>
          </p>
        </div>
      </div>

      {next && (
        <Card>
          <div className="mb-2 flex justify-between text-sm font-bold text-ink-soft">
            <span>
              {totalXp} XP · next: {next.name}
            </span>
            <span>{next.minXp} XP</span>
          </div>
          <ProgressBar pct={(totalXp - level.minXp) / (next.minXp - level.minXp)} />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Streak" value={`🔥 ${count}`} sub={`longest ${streak.longest}`} />
        <Stat label="Freezes" value={`🧊 ${streak.freezesOwned}`} sub="auto-protect" />
        <Stat label="Units done" value={`👑 ${unitsDone}`} sub={`of ${allUnits().length}`} />
        <Stat label="Phrases" value={`💬 ${phrasesLearned}`} sub="in your deck" />
      </div>

      <Card>
        <h3 className="mb-3 font-extrabold">This week</h3>
        <div className="flex items-end justify-between gap-2" style={{ height: 110 }}>
          {week.map((w) => (
            <div key={w.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-bold text-ink-soft">{w.xp || ''}</span>
              <div
                className={`w-full rounded-t-lg ${w.day === today ? 'bg-marigold' : 'bg-teal/60'}`}
                style={{ height: `${Math.max(4, (w.xp / maxWeek) * 80)}px` }}
              />
              <span className="text-[10px] font-bold text-ink-soft">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${w.day}T12:00:00Z`).getUTCDay()]}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-marigold bg-amber-soft">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🎯</span>
          <div>
            <div className="font-extrabold">December fluency goal</div>
            <div className="text-sm font-semibold text-ink-soft">
              {daysToGoal} days left — keep the streak alive and you'll be chatting in Hyderabad like a local.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="py-4">
      <div className="text-xs font-bold uppercase text-ink-soft">{label}</div>
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-xs font-semibold text-ink-soft">{sub}</div>
    </Card>
  );
}
