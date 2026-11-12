// Profile: level, streak, stats, weekly XP chart, December goal countdown.

import { useEffect, useState } from 'react';
import { useApp, useStreakStanding } from '../store';
import { db } from '../db/schema';
import { levelForXp, nextLevel } from '../engine/xp';
import { allUnits } from '../content/load';
import { deviceTimeZone, localDay, addDays } from '../engine/streak';
import { learnedCount } from '../engine/games';
import { Award, ChevronRight, Flame, MessageCircle, Snowflake } from 'lucide-react';
import { Card, Coin, ProgressBar } from '../components/ui';
import { BADGES } from '../engine/badges';
import { Mascot } from '../components/Mascot';

export function Profile() {
  const profile = useApp((s) => s.profile);
  const totalXp = useApp((s) => s.totalXp);
  const streak = useApp((s) => s.streak);
  const unitProgress = useApp((s) => s.unitProgress);
  const srsCards = useApp((s) => s.srsCards);
  const { count } = useStreakStanding();
  const coins = useApp((s) => s.coins);
  const badges = useApp((s) => s.badges);
  const navigate = useApp((s) => s.navigate);
  const [week, setWeek] = useState<{ day: string; xp: number }[]>([]);

  const today = localDay(new Date(), deviceTimeZone());

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
  // only phrases that still exist in the course (ids retired by a content update do not count)
  const phrasesLearned = learnedCount(srsCards);
  const daysToGoal = Math.max(0, Math.round((Date.UTC(2026, 11, 31) - Date.parse(`${today}T00:00:00Z`)) / 86400000));
  const maxWeek = Math.max(35, ...week.map((w) => w.xp));

  return (
    <div className="flex flex-col gap-5">
      <div className="surface-hero flex items-center gap-4 p-5">
        <Mascot pose="cheer" size={90} />
        <div className="min-w-0 flex-1">
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
        <Stat label="Streak" icon={<Flame size={20} className="fill-flame text-flame" />} value={String(count)} sub={`longest ${streak.longest}`} />
        <Stat label="Freezes" icon={<Snowflake size={20} className="text-teal" />} value={String(streak.freezesOwned)} sub="auto-protect" />
        <Stat label="Units done" icon={<Award size={20} className="text-accent-dark" />} value={String(unitsDone)} sub={`of ${allUnits().length}`} />
        <Stat label="Phrases" icon={<MessageCircle size={20} className="text-teal" />} value={String(phrasesLearned)} sub="in your deck" />
      </div>

      <button type="button" onClick={() => navigate({ name: 'shop' })} className="surface flex items-center gap-3 p-4 text-left active:scale-[0.99]">
        <Coin size={28} />
        <div className="flex-1">
          <div className="font-extrabold">{coins} coins</div>
          <div className="text-sm font-semibold text-ink-soft">Spend them in the shop</div>
        </div>
        <ChevronRight className="text-ink-soft" />
      </button>

      <button type="button" onClick={() => navigate({ name: 'badges' })} className="surface flex items-center gap-3 p-4 text-left active:scale-[0.99]" aria-label="See all badges">
        <Award size={28} className="text-accent-dark" />
        <div className="flex-1">
          <div className="font-extrabold">
            {badges.length} of {BADGES.length} badges
          </div>
          <div className="text-sm font-semibold text-ink-soft">See all</div>
        </div>
        <ChevronRight className="text-ink-soft" />
      </button>

      <Card>
        <h3 className="mb-3 font-extrabold">This week</h3>
        <div className="flex items-end justify-between gap-2" style={{ height: 110 }}>
          {week.map((w) => (
            <div key={w.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-bold text-ink-soft">{w.xp || ''}</span>
              <div
                className={`w-full rounded-t-lg ${w.day === today ? 'bg-accent' : 'bg-teal/60'}`}
                style={{ height: `${Math.max(4, (w.xp / maxWeek) * 80)}px` }}
              />
              <span className="text-[10px] font-bold text-ink-soft">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${w.day}T12:00:00Z`).getUTCDay()]}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="bg-accent-soft">
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

function Stat({ label, value, sub, icon }: { label: string; value: string; sub: string; icon?: React.ReactNode }) {
  return (
    <Card className="py-4">
      <div className="text-xs font-bold uppercase text-ink-soft">{label}</div>
      <div className="flex items-center gap-1.5 text-2xl font-extrabold">
        {icon}
        {value}
      </div>
      <div className="text-xs font-semibold text-ink-soft">{sub}</div>
    </Card>
  );
}
