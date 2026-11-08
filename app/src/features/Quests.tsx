// Daily quests: two small goals and a chest. Variable reward keeps it fun.
import { useState } from 'react';
import { Gift, Lock, Sparkles } from 'lucide-react';
import { useApp } from '../store';
import { Card, Coin, ProgressBar } from '../components/ui';
import { FlyingCoins } from '../components/motion';
import { Mascot } from '../components/Mascot';
import { coinTarget } from '../engine/rewards';
import { isComplete, questTitle, type Quest } from '../engine/quests';
import { sfx } from '../audio';

function Chest({ quest, onClaim }: { quest: Quest; onClaim: () => Promise<number> }) {
  const [phase, setPhase] = useState<'idle' | 'opening' | 'open'>('idle');
  const [reward, setReward] = useState<number | null>(quest.reward);
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null);
  const ready = isComplete(quest) && !quest.claimedAt;
  const claim = async () => {
    if (!ready || phase !== 'idle') return;
    setPhase('opening');
    sfx.tick();
    await new Promise((r) => setTimeout(r, 700));
    const coins = await onClaim();
    setReward(coins);
    setPhase('open');
    setFly(coinTarget());
    sfx.coin();
  };
  if (quest.claimedAt || phase === 'open') {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-success-soft px-3 py-2 text-success-dark animate-pop" data-testid="quest-claimed">
        <Sparkles size={18} />
        <span className="font-extrabold">+{reward ?? quest.reward ?? 0}</span>
        <Coin size={16} />
        {fly && <FlyingCoins target={fly} count={8} onDone={() => setFly(null)} />}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={claim}
      disabled={!ready}
      aria-label={ready ? 'Open chest' : 'Chest locked'}
      className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-transform ${
        ready ? 'btn-accent text-white shadow-float active:scale-95 animate-wobble' : 'bg-line/70 text-ink-soft'
      } ${phase === 'opening' ? 'scale-110' : ''}`}
    >
      {ready ? <Gift size={26} /> : <Lock size={20} />}
    </button>
  );
}

export function Quests() {
  const quests = useApp((s) => s.quests);
  const claimQuest = useApp((s) => s.claimQuest);
  const doneCount = quests.filter((q) => q.claimedAt).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="surface-hero flex items-center gap-4 p-5">
        <Mascot pose={doneCount === quests.length && quests.length > 0 ? 'celebrate' : 'teach'} size={84} />
        <div>
          <h1 className="text-2xl font-extrabold">Today's quests</h1>
          <p className="text-sm font-semibold text-ink-soft">Two small goals. Finish one, open the chest.</p>
        </div>
      </div>
      {quests.map((q) => {
        const pct = Math.min(1, q.progress / q.target);
        return (
          <Card key={q.id} className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-extrabold">{questTitle(q)}</h2>
                <span className="text-sm font-bold text-ink-soft" data-testid="quest-progress">
                  {Math.min(q.progress, q.target)}/{q.target}
                </span>
              </div>
              <ProgressBar pct={pct} className="mt-2" color={pct >= 1 ? 'btn-success' : 'btn-accent'} />
            </div>
            <Chest quest={q} onClaim={() => claimQuest(q.id)} />
          </Card>
        );
      })}
      <p className="text-center text-sm font-semibold text-ink-soft">New quests arrive at midnight.</p>
    </div>
  );
}
