// Adaptive placement test: multiple-choice meaning questions over a bank of
// items sampled across sections/difficulties.

import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { allUnits, trackItems } from '../content/load';
import {
  answerPlacement,
  nextPlacementItem,
  startPlacement,
  startSectionForTier,
  type PlacementQuestionRef,
  type PlacementState,
} from '../engine/placement';
import { rngFromSeed, pickN, shuffled } from '../engine/rng';
import { Button, Card, ProgressBar } from '../components/ui';
import { Mascot } from '../components/Mascot';
import { sfx } from '../audio';

function buildBank(): PlacementQuestionRef[] {
  // Sample up to 6 items per difficulty tier across all loaded units.
  const rng = rngFromSeed('placement-bank-v1');
  const bank: PlacementQuestionRef[] = [];
  for (let t = 1; t <= 5; t++) {
    const pool = trackItems('speak').filter((i) => i.difficulty === t);
    bank.push(...pickN(pool, 6, rng).map((i) => ({ itemId: i.id, tier: t as 1 | 2 | 3 | 4 | 5 })));
  }
  return bank;
}

export function Placement() {
  const finishPlacement = useApp((s) => s.finishPlacement);
  const awardXp = useApp((s) => s.awardXp);
  const bank = useMemo(buildBank, []);
  const [state, setState] = useState<PlacementState>(startPlacement);
  const [chosen, setChosen] = useState<string | null>(null);

  const itemId = state.done ? null : nextPlacementItem(state, bank);
  const item = itemId ? trackItems('speak').find((i) => i.id === itemId) : null;

  const choices = useMemo(() => {
    if (!item) return [];
    const rng = rngFromSeed(`placement-${item.id}`);
    const others = trackItems('speak').filter((i) => i.id !== item.id && Math.abs(i.difficulty - item.difficulty) <= 1);
    return shuffled([item, ...pickN(others, 3, rng)], rng);
  }, [item]);

  if (state.done || !item) {
    const tier = state.resultTier ?? 0;
    const section = startSectionForTier(tier);
    const sectionUnits = allUnits().filter((u) => u.section === section);
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center animate-pop">
        <Mascot pose="celebrate" size={150} />
        <h2 className="text-3xl font-extrabold text-teal">
          {tier >= 3 ? 'అద్భుతం! Impressive!' : tier >= 1 ? 'బాగుంది! Nice base!' : "Let's build it together!"}
        </h2>
        <p className="text-lg font-semibold text-ink-soft">
          You'll start at <span className="font-extrabold text-ink">Section {section}</span>
          {sectionUnits[0] ? ` — “${sectionUnits[0].title}”` : ''}. Everything before it is unlocked for review
          whenever you want.
        </p>
        <Button
          className="w-full text-lg"
          onClick={async () => {
            await awardXp(10, 'placement', 'placement');
            await finishPlacement(section);
          }}
        >
          Start learning
        </Button>
      </div>
    );
  }

  const progress = state.asked.length / 18;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <ProgressBar pct={progress} color="bg-teal" />
      <div className="flex items-center gap-3">
        <Mascot pose="teach" size={64} />
        <h2 className="text-xl font-extrabold">What does this mean?</h2>
      </div>
      <Card className="text-center">
        <div className="text-2xl font-extrabold">{item.roman}</div>
        <div className="te-script mt-1 text-lg text-ink-soft">{item.te}</div>
      </Card>
      <div className="flex flex-col gap-3">
        {choices.map((c) => (
          <Button
            key={c.id}
            variant={chosen === c.id ? (c.id === item.id ? 'success' : 'danger') : 'ghost'}
            className="normal-case text-left tracking-normal"
            disabled={chosen !== null}
            onClick={() => {
              setChosen(c.id);
              const correct = c.id === item.id;
              if (correct) sfx.correct();
              else sfx.wrong();
              setTimeout(() => {
                setChosen(null);
                setState((s) => answerPlacement(s, item.id, correct));
              }, 650);
            }}
          >
            {c.gloss}
          </Button>
        ))}
      </div>
    </div>
  );
}
