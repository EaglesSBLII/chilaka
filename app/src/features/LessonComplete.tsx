// Post-lesson celebration: streak-milestone takeover (when earned), then the
// summary — XP, accuracy, coins flying into the balance, quests, badges.

import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { Award, Flame, Gift, Snowflake, Sparkles, Target } from 'lucide-react';
import { useApp, type XpAward } from '../store';
import { Button, Card, Coin } from '../components/ui';
import { FlyingCoins } from '../components/motion';
import { Mascot } from '../components/Mascot';
import { sfx } from '../audio';
import { celebrationLevel } from '../engine/coins';
import { coinTarget, type LessonRewards } from '../engine/rewards';
import { questTitle } from '../engine/quests';
import { BADGES } from '../engine/badges';

export interface CompletionStats {
  xp: number;
  pct: number;
  award: XpAward;
  rewards: LessonRewards;
  unitTitle: string;
  lessonTitle: string;
}

function useCountUp(target: number, tick = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let v = 0;
    const step = Math.max(1, Math.ceil(target / 24));
    const t = setInterval(() => {
      v = Math.min(target, v + step);
      setN(v);
      if (tick && v > 0 && v < target) sfx.tick();
      if (v >= target) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  }, [target, tick]);
  return n;
}

function Milestone({ days, onDone }: { days: number; onDone: () => void }) {
  const level = celebrationLevel(days);
  useEffect(() => {
    sfx.fanfare();
    const bursts = level >= 3 ? 4 : level === 2 ? 3 : 2;
    for (let i = 0; i < bursts; i++) {
      setTimeout(
        () =>
          confetti({
            particleCount: [120, 150, 250, 400][level],
            spread: 80 + i * 20,
            startVelocity: 45,
            origin: { y: 0.6, x: 0.5 },
            colors: ['#f5a623', '#ff5c39', '#17a196', '#ffffff'],
          }),
        i * 350,
      );
    }
  }, [level]);
  return (
    <div className="surface-hero fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 rounded-none px-6 text-center" data-testid="milestone">
      <Mascot pose="celebrate" size={180} />
      <div className="flex items-center gap-2 text-6xl font-extrabold text-flame animate-pop">
        <Flame size={56} className="fill-flame" />
        {days}
      </div>
      <h1 className="text-3xl font-extrabold text-balance">{days}-day streak!</h1>
      <p className="max-w-xs font-semibold text-ink-soft">
        {days >= 100 ? 'Legendary. Few people get here.' : days >= 30 ? 'A whole month of Telugu. Incredible.' : days >= 7 ? 'A full week. This is how habits are made.' : 'Three days in. Keep the fire going.'}
      </p>
      <Button className="mt-2 w-full max-w-xs text-lg" onClick={onDone}>
        Continue
      </Button>
    </div>
  );
}

export function LessonComplete({ stats }: { stats: CompletionStats }) {
  const navigate = useApp((s) => s.navigate);
  const { award, rewards } = stats;
  const [milestoneShown, setMilestoneShown] = useState(rewards.milestone !== null);
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null);
  const shownXp = useCountUp(stats.xp);
  const shownCoins = useCountUp(rewards.coins.total, false);
  const perfect = stats.pct >= 1;

  useEffect(() => {
    if (milestoneShown) return;
    const t = setTimeout(() => {
      setFly(coinTarget());
      sfx.coin();
    }, 500);
    return () => clearTimeout(t);
  }, [milestoneShown]);

  if (milestoneShown && rewards.milestone !== null) {
    return <Milestone days={rewards.milestone} onDone={() => setMilestoneShown(false)} />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-8 text-center">
      {fly && <FlyingCoins target={fly} count={Math.min(14, 6 + Math.floor(rewards.coins.total / 5))} onDone={() => setFly(null)} />}
      <Mascot pose="celebrate" size={150} />
      <h1 className="text-3xl font-extrabold text-teal animate-pop">Lesson complete!</h1>
      <p className="font-semibold text-ink-soft">
        {stats.unitTitle} · {stats.lessonTitle}
      </p>

      <div className="grid w-full grid-cols-3 gap-2">
        <Card className="p-3">
          <div className="text-[10px] font-bold uppercase text-ink-soft">XP</div>
          <div className="text-2xl font-extrabold text-accent-dark">+{shownXp}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] font-bold uppercase text-ink-soft">Accuracy</div>
          <div className="text-2xl font-extrabold text-success-dark">{Math.round(stats.pct * 100)}%</div>
        </Card>
        <Card className="p-3" data-testid="coins-earned">
          <div className="text-[10px] font-bold uppercase text-ink-soft">Coins</div>
          <div className="flex items-center justify-center gap-1 text-2xl font-extrabold text-accent-dark">
            <Coin size={20} className={shownCoins >= rewards.coins.total ? 'animate-coin' : ''} />+{shownCoins}
          </div>
        </Card>
      </div>

      {perfect && (
        <div className="flex w-full items-center justify-center gap-2 rounded-2xl btn-success px-4 py-2 font-extrabold text-white shadow-soft animate-pop" data-testid="perfect">
          <Sparkles size={18} /> Perfect lesson · +{rewards.coins.perfect} coins
        </div>
      )}

      {award.streakExtended && (
        <Card className="flex w-full items-center gap-3 animate-pop">
          <Flame size={28} className="fill-flame text-flame" />
          <div className="text-left">
            <div className="text-xl font-extrabold text-flame">
              {award.streakCount}-day streak{award.streakCount === 1 ? ' started!' : '!'}
            </div>
            {award.freezesConsumed > 0 && (
              <div className="text-sm font-semibold text-ink-soft">
                A streak freeze covered {award.freezesConsumed} missed day{award.freezesConsumed > 1 ? 's' : ''}.
              </div>
            )}
          </div>
        </Card>
      )}

      {award.goalJustReached && (
        <Card className="flex w-full items-center gap-3 animate-pop">
          <Target size={28} className="text-teal" />
          <div className="text-left">
            <div className="text-lg font-extrabold text-teal">Daily goal reached</div>
            {rewards.coins.goal > 0 && <div className="text-sm font-semibold text-ink-soft">+{rewards.coins.goal} coins</div>}
          </div>
        </Card>
      )}

      {award.freezesEarnedNow > 0 && (
        <Card className="flex w-full items-center gap-3 animate-pop">
          <Snowflake size={28} className="text-teal" />
          <div className="text-left">
            <div className="text-lg font-extrabold text-teal">Streak freeze earned</div>
            <div className="text-sm font-semibold text-ink-soft">It protects your streak if you miss a day.</div>
          </div>
        </Card>
      )}

      {rewards.questsCompleted.length > 0 && (
        <Card className="flex w-full flex-col gap-2 animate-pop" data-testid="quest-done">
          {rewards.questsCompleted.map((q) => (
            <div key={q.id} className="flex items-center gap-3">
              <Gift size={26} className="text-accent-dark" />
              <div className="flex-1 text-left">
                <div className="font-extrabold">Quest complete: {questTitle(q)}</div>
                <div className="text-sm font-semibold text-ink-soft">A chest is waiting for you.</div>
              </div>
            </div>
          ))}
          <Button variant="secondary" className="mt-1 w-full" onClick={() => navigate({ name: 'quests' })}>
            Open chest
          </Button>
        </Card>
      )}

      {rewards.badgesEarned.map((b) => {
        const def = BADGES.find((d) => d.id === b.id);
        return (
          <Card key={b.id} className="flex w-full items-center gap-3 animate-pop" data-testid="badge-earned">
            <Award size={28} className="text-accent-dark" />
            <div className="text-left">
              <div className="font-extrabold">
                {def?.name ?? b.id} · {['', 'Bronze', 'Silver', 'Gold'][b.tier]}
              </div>
              <div className="text-sm font-semibold text-ink-soft">New badge{rewards.coins.milestone ? '' : ''} unlocked.</div>
            </div>
          </Card>
        );
      })}

      <Button className="mt-2 w-full text-lg" onClick={() => navigate({ name: 'path' })}>
        Continue
      </Button>
    </div>
  );
}
