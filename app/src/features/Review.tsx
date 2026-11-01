// FSRS flashcard review: due cards, flip, self-rate.

import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { itemById } from '../content/load';
import { dueCards, Rating } from '../engine/srs';
import { playItemAudio, sfx } from '../audio';
import { Button, Card } from '../components/ui';
import { Mascot } from '../components/Mascot';
import { xpForReviewCard } from '../engine/xp';

const SESSION_CAP = 20;

export function Review() {
  const srsCards = useApp((s) => s.srsCards);
  const applyReview = useApp((s) => s.applyReview);
  const awardXp = useApp((s) => s.awardXp);
  const scriptMode = useApp((s) => s.profile?.scriptMode ?? 'roman+telugu');

  const session = useMemo(
    () =>
      dueCards(Object.values(srsCards), new Date())
        .slice(0, SESSION_CAP)
        .map((c) => c.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  if (session.length === 0 || idx >= session.length) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Mascot pose={doneCount > 0 ? 'celebrate' : 'sleepy'} size={130} />
        <h2 className="text-2xl font-extrabold text-teal">
          {doneCount > 0 ? `Reviewed ${doneCount} cards! 🎉` : 'Nothing due right now'}
        </h2>
        <p className="max-w-sm font-semibold text-ink-soft">
          {doneCount > 0
            ? 'Chikki will bring these back right before you would forget them.'
            : 'Finish more lessons and your review deck fills up automatically.'}
        </p>
      </div>
    );
  }

  const itemId = session[idx];
  const item = itemById(itemId);
  if (!item) {
    setIdx((i) => i + 1);
    return null;
  }

  const rate = async (rating: Rating) => {
    const correct = rating !== Rating.Again;
    if (correct) sfx.correct();
    else sfx.wrong();
    await applyReview(itemId, rating);
    await awardXp(xpForReviewCard(correct), 'review', itemId);
    setDoneCount((n) => n + 1);
    setFlipped(false);
    setIdx((i) => i + 1);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Review</h2>
        <span className="font-bold text-ink-soft">
          {idx + 1} / {session.length}
        </span>
      </div>

      <Card
        className="flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 py-10 text-center"
        // flip on click anywhere
      >
        <button className="flex flex-col items-center gap-3 w-full" onClick={() => setFlipped(true)}>
          <span
            className="text-2xl"
            onClick={(e) => {
              e.stopPropagation();
              void playItemAudio(itemId);
            }}
          >
            🔊
          </span>
          <div className="text-2xl font-extrabold">{item.roman}</div>
          {scriptMode !== 'roman' && <div className="te-script text-lg text-ink-soft">{item.te}</div>}
          {flipped ? (
            <div className="animate-pop text-xl font-bold text-teal">{item.gloss}</div>
          ) : (
            <div className="text-sm font-bold uppercase tracking-wide text-ink-soft">Tap to reveal</div>
          )}
        </button>
      </Card>

      {flipped ? (
        <div className="grid grid-cols-4 gap-2">
          <Button variant="danger" className="px-2 text-sm" onClick={() => void rate(Rating.Again)}>
            Again
          </Button>
          <Button variant="ghost" className="px-2 text-sm" onClick={() => void rate(Rating.Hard)}>
            Hard
          </Button>
          <Button variant="secondary" className="px-2 text-sm" onClick={() => void rate(Rating.Good)}>
            Good
          </Button>
          <Button variant="success" className="px-2 text-sm" onClick={() => void rate(Rating.Easy)}>
            Easy
          </Button>
        </div>
      ) : (
        <Button onClick={() => setFlipped(true)}>Show answer</Button>
      )}
    </div>
  );
}
