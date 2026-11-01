// Post-lesson celebration: XP count-up, accuracy, streak/freeze/goal callouts.

import { useEffect, useState } from 'react';
import { useApp, type XpAward } from '../store';
import { Button, Card } from '../components/ui';
import { Mascot } from '../components/Mascot';
import { sfx } from '../audio';

export interface CompletionStats {
  xp: number;
  pct: number;
  award: XpAward;
  unitTitle: string;
  lessonTitle: string;
}

export function LessonComplete({ stats }: { stats: CompletionStats }) {
  const navigate = useApp((s) => s.navigate);
  const [shownXp, setShownXp] = useState(0);

  useEffect(() => {
    let n = 0;
    const step = Math.max(1, Math.ceil(stats.xp / 24));
    const t = setInterval(() => {
      n = Math.min(stats.xp, n + step);
      setShownXp(n);
      if (n > 0 && n < stats.xp) sfx.tick();
      if (n >= stats.xp) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  }, [stats.xp]);

  const { award } = stats;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <Mascot pose="celebrate" size={160} />
      <h1 className="text-3xl font-extrabold text-teal animate-pop">Lesson complete!</h1>
      <p className="font-semibold text-ink-soft">
        {stats.unitTitle} · {stats.lessonTitle}
      </p>

      <div className="flex w-full gap-3">
        <Card className="flex-1 border-marigold">
          <div className="text-xs font-bold uppercase text-ink-soft">XP earned</div>
          <div className="text-3xl font-extrabold text-marigold-dark">+{shownXp}</div>
        </Card>
        <Card className="flex-1 border-success">
          <div className="text-xs font-bold uppercase text-ink-soft">Accuracy</div>
          <div className="text-3xl font-extrabold text-success-dark">{Math.round(stats.pct * 100)}%</div>
        </Card>
      </div>

      {award.streakExtended && (
        <Card className="w-full border-flame animate-pop">
          <div className="text-2xl font-extrabold text-flame">
            🔥 {award.streakCount}-day streak{award.streakCount === 1 ? ' started!' : '!'}
          </div>
          {award.freezesConsumed > 0 && (
            <div className="text-sm font-semibold text-ink-soft">
              (a streak freeze covered {award.freezesConsumed} missed day{award.freezesConsumed > 1 ? 's' : ''})
            </div>
          )}
        </Card>
      )}

      {award.goalJustReached && (
        <Card className="w-full border-teal animate-pop">
          <div className="text-xl font-extrabold text-teal">🎯 Daily goal reached!</div>
        </Card>
      )}

      {award.freezesEarnedNow > 0 && (
        <Card className="w-full border-teal animate-pop">
          <div className="text-xl font-extrabold text-teal">🧊 Streak freeze earned!</div>
          <div className="text-sm font-semibold text-ink-soft">It auto-protects your streak if you miss a day.</div>
        </Card>
      )}

      <Button className="w-full text-lg" onClick={() => navigate({ name: 'path' })}>
        Continue
      </Button>
    </div>
  );
}
