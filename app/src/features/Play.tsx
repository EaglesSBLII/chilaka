// Play tab: Chikki's games. Every round is built from phrases the learner has
// met in lessons, leading with the ones spaced repetition says are fading —
// so playing IS the review, without ever being called that.
import { useMemo } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { useApp } from '../store';
import { localDay } from '../engine/streak';
import { featuredGame, gamePool, GAMES, REWARDED_ROUNDS_PER_DAY, type GameDef } from '../engine/games';
import { Button, Card } from '../components/ui';
import { Mascot } from '../components/Mascot';
import { pluralPhrases } from './games/shared';

export function Play() {
  const navigate = useApp((s) => s.navigate);
  const srsCards = useApp((s) => s.srsCards);
  const profile = useApp((s) => s.profile);
  const pool = useMemo(() => gamePool(srsCards), [srsCards]);
  const learned = pool.items.length;
  const due = pool.dueIds.length;
  const day = localDay(new Date(), profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const featured = featuredGame(day);
  const anyOpen = GAMES.some((g) => learned >= g.minItems);

  return (
    <div className="flex flex-col gap-5" data-testid="play-hub" data-learned={learned} data-due={due}>
      <div className="surface-hero flex items-center gap-4 p-5">
        <Mascot pose={anyOpen ? 'cheer' : 'sleepy'} size={84} />
        <div>
          <h1 className="text-2xl font-extrabold">Chikki's Games</h1>
          <p className="text-sm font-semibold text-ink-soft">
            {anyOpen
              ? due > 0
                ? `${pluralPhrases(learned)} in play · ${due} ready for a round`
                : `${pluralPhrases(learned)} in play — all fresh in your memory!`
              : 'Finish your first lesson and Chikki opens the games.'}
          </p>
        </div>
      </div>

      {!anyOpen && (
        <Card className="flex flex-col items-center gap-3 text-center">
          <Lock className="text-ink-soft" />
          <p className="font-semibold text-ink-soft">The games use the words you learn in lessons. Three or four phrases are enough to start.</p>
          <Button onClick={() => navigate({ name: 'path' })}>Go to lessons</Button>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {GAMES.map((g) => (
          <GameCard key={g.id} game={g} learned={learned} featured={g.id === featured.id} onPlay={() => navigate({ name: 'game', game: g.id })} />
        ))}
      </div>

      <p className="text-center text-xs font-semibold text-ink-soft">
        {REWARDED_ROUNDS_PER_DAY} rounds a day earn XP and coins. After that, play as much as you like — just for fun.
      </p>
    </div>
  );
}

function GameCard({ game, learned, featured, onPlay }: { game: GameDef; learned: number; featured: boolean; onPlay: () => void }) {
  const open = learned >= game.minItems;
  return (
    <Card className={`flex items-start gap-4 ${featured ? 'ring-2 ring-marigold/60' : ''}`} data-testid={`play-${game.id}`}>
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-accent-soft text-4xl" aria-hidden="true">
        {game.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-extrabold">{game.name}</h2>
          <span className="te-script text-sm text-ink-soft">{game.teName}</span>
          {featured && (
            <span className="inline-flex items-center gap-1 rounded-full bg-marigold px-2 py-0.5 text-[11px] font-extrabold text-white">
              <Sparkles size={12} /> Today's pick
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-ink-soft">{game.blurb}</p>
        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-ink-soft/80">{game.length}</p>
      </div>
      {open ? (
        <Button className="shrink-0 self-center px-5" onClick={onPlay} aria-label={`Play ${game.name}`}>
          Play
        </Button>
      ) : (
        <span className="shrink-0 self-center text-xs font-bold text-ink-soft">
          Learn {game.minItems - learned} more
        </span>
      )}
    </Card>
  );
}
