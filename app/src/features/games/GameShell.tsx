// One game round, full screen: picks the phrases (due ones first), preloads
// their audio, runs the game, then shows the round summary — stars, XP and
// coins, and the phrases Chikki wants to hear again.
import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { Gift, Sparkles, Target } from 'lucide-react';
import { useApp, type GameRewards } from '../../store';
import { playItemAudio, preloadItemAudio, sfx } from '../../audio';
import { itemById } from '../../content/load';
import { gameById, gamePool, memoryPairsFor, pickRoundItems, REWARDED_ROUNDS_PER_DAY, roundStars, type GameId, type RoundResult } from '../../engine/games';
import { rngFromSeed } from '../../engine/rng';
import { questTitle } from '../../engine/quests';
import { BADGES } from '../../engine/badges';
import { Button, Card, Coin } from '../../components/ui';
import { Mascot } from '../../components/Mascot';
import { FeedChikki } from './FeedChikki';
import { PairPop } from './PairPop';
import { MemoryFlip } from './MemoryFlip';
import { pluralPhrases } from './shared';

export function GameShell({ game }: { game: GameId }) {
  const [roundNo, setRoundNo] = useState(0);
  return <Round key={roundNo} game={game} onAgain={() => setRoundNo((n) => n + 1)} />;
}

function Round({ game, onAgain }: { game: GameId; onAgain: () => void }) {
  const navigate = useApp((s) => s.navigate);
  const srsCards = useApp((s) => s.srsCards);
  const roundsPlayed = useApp((s) => s.reviewCount);
  const def = gameById(game);
  const [seed] = useState(() => `${game}:${Date.now()}:${Math.random()}`);
  // the round's phrases are fixed at mount: answering reschedules cards, and
  // the board must not reshuffle under the player's fingers
  const items = useMemo(() => {
    const pool = gamePool(srsCards);
    const n = game === 'feed' ? 8 : game === 'pairs' ? 15 : memoryPairsFor(pool.items.length, roundsPlayed);
    return pickRoundItems(pool.items, pool.dueIds, pool.recentIds, n, rngFromSeed(seed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [rewards, setRewards] = useState<GameRewards | null>(null);

  useEffect(() => {
    preloadItemAudio(items.map((it) => it.id));
  }, [items]);

  const finish = async (r: RoundResult) => {
    setResult(r);
    const rw = await useApp.getState().finishGameRound(r);
    setRewards(rw);
    sfx.complete();
    if (roundStars(r) === 3) {
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, colors: ['#F5A623', '#FF5C39', '#3CB46E', '#0E6B63'] });
    }
  };

  const quit = () => navigate({ name: 'play' });

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-5 py-6" data-testid="game" data-game={game}>
      <div className="flex items-center gap-3">
        <button onClick={quit} className="text-2xl text-ink-soft transition-transform active:scale-90" aria-label="Quit game">
          ✕
        </button>
        <h1 className="flex-1 text-lg font-extrabold">
          {def.emoji} {def.name}
        </h1>
      </div>

      {items.length < def.minItems ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Mascot pose="sleepy" size={120} />
          <p className="max-w-xs font-bold text-ink-soft">
            {def.name} needs {pluralPhrases(def.minItems)} you have learned. Finish another lesson and come back!
          </p>
          <Button onClick={() => navigate({ name: 'path' })}>Go to lessons</Button>
        </div>
      ) : result ? (
        <Summary result={result} rewards={rewards} onAgain={onAgain} onDone={quit} />
      ) : (
        <div className="flex flex-1 flex-col py-4">
          {game === 'feed' && <FeedChikki items={items} seed={seed} roundsPlayed={roundsPlayed} onFinish={(r) => void finish(r)} />}
          {game === 'pairs' && <PairPop items={items} seed={seed} roundsPlayed={roundsPlayed} onFinish={(r) => void finish(r)} />}
          {game === 'memory' && <MemoryFlip items={items} seed={seed} roundsPlayed={roundsPlayed} onFinish={(r) => void finish(r)} />}
        </div>
      )}
    </div>
  );
}

function Summary({
  result,
  rewards,
  onAgain,
  onDone,
}: {
  result: RoundResult;
  rewards: GameRewards | null;
  onAgain: () => void;
  onDone: () => void;
}) {
  const stars = roundStars(result);
  const missed = result.outcomes.filter((o) => !o.firstTry).map((o) => itemById(o.itemId)).filter(Boolean);
  const right = result.outcomes.filter((o) => o.firstTry).length;
  return (
    <div className="flex flex-1 flex-col gap-4 py-4 animate-pop" data-testid="game-summary">
      <div className="flex flex-col items-center gap-2 text-center">
        <Mascot pose={stars === 3 ? 'celebrate' : 'cheer'} size={120} />
        <h2 className="text-2xl font-extrabold text-teal">{stars === 3 ? 'Perfect round!' : stars === 2 ? 'Great round!' : 'Round complete!'}</h2>
        <div className="text-3xl" aria-label={`${stars} of 3 stars`}>
          {'★'.repeat(stars)}
          <span className="text-line">{'★'.repeat(3 - stars)}</span>
        </div>
        <p className="font-semibold text-ink-soft">
          {right} of {result.outcomes.length} right first time
          {result.bestCombo >= 3 ? ` · best combo ${result.bestCombo}` : ''}
        </p>
      </div>

      <Card className="flex items-center justify-around py-4">
        <div className="text-center">
          <div className="text-2xl font-extrabold text-accent-dark">+{rewards?.xp ?? 0}</div>
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">XP</div>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-2xl font-extrabold">
            <Coin size={22} /> +{rewards?.coins ?? 0}
          </div>
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">coins</div>
        </div>
      </Card>
      {rewards && !rewards.rewarded && (
        <p className="text-center text-sm font-semibold text-ink-soft">
          Chikki's treat bag is empty for today ({REWARDED_ROUNDS_PER_DAY} rounds) — this one was just for fun!
        </p>
      )}

      {missed.length > 0 && (
        <Card>
          <h3 className="mb-2 flex items-center gap-2 font-extrabold">
            <Sparkles size={18} className="text-marigold" /> Chikki's favourites — hear them again
          </h3>
          <ul className="flex flex-col gap-2">
            {missed.map((it) => (
              <li key={it!.id} className="flex items-center gap-3">
                <button onClick={() => void playItemAudio(it!.id)} className="text-xl active:scale-90" aria-label={`Play ${it!.roman}`}>
                  🔊
                </button>
                <span className="flex-1">
                  <span className="font-extrabold">{it!.roman}</span> <span className="te-script text-ink-soft">{it!.te}</span>
                </span>
                <span className="text-sm font-bold text-teal">{it!.gloss}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rewards && (rewards.questsCompleted.length > 0 || rewards.badgesEarned.length > 0) && (
        <div className="flex flex-wrap justify-center gap-2">
          {rewards.questsCompleted.map((q) => (
            <span key={q.id} className="inline-flex items-center gap-1 rounded-full bg-success-soft px-3 py-1 text-sm font-extrabold text-success-dark">
              <Target size={14} /> Quest done: {questTitle(q)}
            </span>
          ))}
          {rewards.badgesEarned.map((b) => (
            <span key={`${b.id}:${b.tier}`} className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-3 py-1 text-sm font-extrabold text-marigold-dark">
              <Gift size={14} /> Badge: {BADGES.find((d) => d.id === b.id)?.name ?? b.id}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex gap-3">
        <Button variant="ghost" className="flex-1" onClick={onDone}>
          Done
        </Button>
        <Button className="flex-[2]" onClick={onAgain}>
          Play again
        </Button>
      </div>
    </div>
  );
}
