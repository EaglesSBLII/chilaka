// The home screen: a full-screen jungle with the winding lesson trail,
// hero greeting, dotted connectors, and section canopy banners.

import { Fragment, useEffect } from 'react';
import { useApp, useDailyGoal, useStreakStanding, useUnitStatus } from '../store';
import { trackUnits } from '../content/load';
import { KeyboardHelp } from './exercises/KeyboardHelp';
import { Check, Crown, Flame, Lock, MessageSquareText, Play, Snowflake, Star } from 'lucide-react';
import { Mascot } from '../components/Mascot';
import { FullJungle, JungleCanopy } from '../components/Jungle';
import { ProgressBar, Ring } from '../components/ui';
import type { Unit } from '../engine/types';

const SECTION_META: Record<string, Record<number, { title: string; color: string; emoji: string }>> = {
  speak: {
    0: { title: 'First words', color: 'text-teal', emoji: '👋' },
    1: { title: 'Getting your Telugu back', color: 'text-teal', emoji: '🌱' },
    2: { title: 'Daily life', color: 'text-marigold-dark', emoji: '🏡' },
    3: { title: 'Real conversations', color: 'text-flame', emoji: '💬' },
    4: { title: 'Out in the city', color: 'text-teal', emoji: '🛺' },
    5: { title: 'Family & feelings', color: 'text-marigold-dark', emoji: '💛' },
    6: { title: 'Getting things done', color: 'text-flame', emoji: '📋' },
    7: { title: 'Speak like a local', color: 'text-teal', emoji: '🌶️' },
    8: { title: 'Full flow', color: 'text-marigold-dark', emoji: '🌊' },
  },
  script: {
    1: { title: 'The letters · అక్షరాలు', color: 'text-teal', emoji: '✍️' },
    2: { title: 'Words & reading · పదాలు', color: 'text-marigold-dark', emoji: '📖' },
  },
};

const PITCH = 88; // node row height (64px node + 24px gap)
const AMP = 70; // sine amplitude of the winding trail

function offsetFor(index: number): number {
  return Math.round(Math.sin((index / 2.2) * Math.PI) * AMP);
}

function LessonNode({
  unit,
  lessonId,
  index,
  state,
}: {
  unit: Unit;
  lessonId: string;
  index: number;
  state: 'done' | 'current' | 'replayable' | 'locked';
}) {
  const navigate = useApp((s) => s.navigate);
  const locked = state === 'locked';
  return (
    <div className="flex justify-center" style={{ transform: `translateX(${offsetFor(index)}px)` }}>
      <button
        disabled={locked}
        data-current-lesson={state === 'current' ? 'true' : undefined}
        aria-label={`${unit.title} lesson ${index + 1}`}
        onClick={() => navigate({ name: 'lesson', unitId: unit.id, lessonId })}
        className={`relative flex h-[68px] w-[68px] items-center justify-center rounded-full text-white transition-transform active:scale-95 ${
          state === 'done'
            ? 'btn-accent shadow-float'
            : locked
              ? 'bg-locked/80 text-white/70 cursor-not-allowed'
              : state === 'replayable'
                ? 'btn-teal opacity-90 shadow-soft'
                : 'btn-teal shadow-float animate-breathe ring-4 ring-white/70'
        }`}
      >
        {state === 'done' && <span className="sr-only">✓</span>}
        {state === 'done' ? <Check size={30} strokeWidth={3} /> : locked ? <Lock size={24} /> : state === 'current' ? <Play size={28} className="ml-1 fill-white" /> : <Star size={26} className="fill-white/90" />}
        {state === 'current' && (
          <span className="glass absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-xs font-extrabold text-teal">
            START
          </span>
        )}
      </button>
    </div>
  );
}

function DialogueNode({ unit, status }: { unit: Unit; status: 'locked' | 'active' | 'done' }) {
  const navigate = useApp((s) => s.navigate);
  const unitProgress = useApp((s) => s.unitProgress);
  if (!unit.dialogue) return null;
  const done = unitProgress[unit.id]?.dialogueDone ?? false;
  const locked = status === 'locked';
  return (
    <div className="flex justify-center" style={{ transform: 'translateX(-40px)' }}>
      <button
        disabled={locked}
        onClick={() => navigate({ name: 'dialogue', unitId: unit.id })}
        aria-label={`${unit.title} dialogue`}
        className={`flex h-16 w-16 items-center justify-center rounded-[22px] text-white transition-transform active:scale-95 ${
          done ? 'btn-accent shadow-float' : locked ? 'bg-locked/80 cursor-not-allowed text-white/70' : 'btn-error shadow-float ring-4 ring-white/60'
        }`}
      >
        <MessageSquareText size={28} />
      </button>
    </div>
  );
}

/** Dotted trail connecting the unit's nodes, drawn behind them. */
function Trail({ unit }: { unit: Unit }) {
  const rows = unit.lessons.length + (unit.dialogue ? 1 : 0);
  const pts: [number, number][] = [];
  for (let i = 0; i < unit.lessons.length; i++) pts.push([160 + offsetFor(i), 32 + i * PITCH]);
  if (unit.dialogue) pts.push([160 - 40, 32 + unit.lessons.length * PITCH]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const my = (y0 + y1) / 2;
    d += ` C ${x0} ${my}, ${x1} ${my}, ${x1} ${y1}`;
  }
  return (
    <svg
      className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2"
      width="320"
      height={rows * PITCH}
      viewBox={`0 0 320 ${rows * PITCH}`}
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke="var(--c-line)" strokeWidth="10" strokeLinecap="round" opacity="0.9" />
      <path d={d} fill="none" stroke="var(--c-ink-soft)" strokeWidth="3" strokeDasharray="1 14" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function UnitBlock({ unit }: { unit: Unit }) {
  const statusOf = useUnitStatus();
  const unitProgress = useApp((s) => s.unitProgress);
  const profile = useApp((s) => s.profile);
  const status = statusOf(unit.id);
  const up = unitProgress[unit.id];
  // a placement start applies to the speaking course only; reading & writing
  // always runs in order from its first lesson (as useUnitStatus has it)
  const startSection = unit.track === 'speak' ? (profile?.startSection ?? 1) : 0;
  const doneSet = new Set(up?.lessonsDone ?? []);
  const firstIncomplete = unit.lessons.findIndex((l) => !doneSet.has(l.id));
  const lessonState = (lessonId: string, i: number): 'done' | 'current' | 'replayable' | 'locked' => {
    if (status === 'locked') return 'locked';
    if (doneSet.has(lessonId)) return 'done';
    // units before a placed-ahead start are open for review, but "current" —
    // the pulsing START the home screen scrolls to — is only where the learner
    // actually is
    if (unit.section < startSection) return 'replayable';
    if (i === firstIncomplete) return 'current';
    return 'locked';
  };
  const doneCount = unit.lessons.filter((l) => doneSet.has(l.id)).length;
  return (
    <div id={`unit-${unit.id}`} className={`relative ${status === 'locked' ? 'opacity-60' : ''}`}>
      <div className="surface relative mb-5 flex items-center gap-3 px-4 py-3">
        <Ring pct={doneCount / unit.lessons.length} size={44} stroke={5} color={status === 'done' ? 'var(--c-accent)' : 'var(--c-teal)'}>
          {status === 'done' ? <Crown size={18} className="text-accent-dark" /> : <span className="text-[11px] font-extrabold text-ink-soft">{doneCount}/{unit.lessons.length}</span>}
        </Ring>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-extrabold leading-tight">{unit.title}</h3>
          <p className="text-sm font-semibold text-ink-soft">{unit.description}</p>
        </div>
        {unit.teTitle && <div className="te-script shrink-0 text-right text-sm font-bold text-teal">{unit.teTitle}</div>}
      </div>
      <div className="relative flex flex-col gap-6 py-2">
        <Trail unit={unit} />
        {unit.lessons.map((l, i) => (
          <LessonNode key={l.id} unit={unit} lessonId={l.id} index={i} state={lessonState(l.id, i)} />
        ))}
        <DialogueNode unit={unit} status={status} />
      </div>
    </div>
  );
}

function Hero() {
  const profile = useApp((s) => s.profile);
  const { count } = useStreakStanding();
  const streak = useApp((s) => s.streak);
  const { goal, earned, pct } = useDailyGoal();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'శుభోదయం' : hour < 17 ? 'నమస్కారం' : 'శుభ సాయంత్రం';
  return (
    <div className="surface-hero relative overflow-hidden p-5">
      <div className="flex items-center gap-4">
        <Mascot pose={pct >= 1 ? 'celebrate' : 'cheer'} size={92} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold leading-tight">
            <span className="te-script text-teal">{greeting}</span>
            {profile?.name ? `, ${profile.name}!` : '!'}
          </h1>
          <p className="text-sm font-semibold text-ink-soft">
            {pct >= 1 ? 'Daily goal done — keep flying!' : `${goal - earned} XP to today's goal`}
          </p>
          <ProgressBar pct={pct} className="mt-2" color={pct >= 1 ? 'btn-success' : 'btn-accent'} />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-card/70 px-3 py-1 text-sm font-extrabold text-flame shadow-press">
          <Flame size={16} className="fill-flame" /> {count}-day streak
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-card/70 px-3 py-1 text-sm font-extrabold text-teal shadow-press">
          <Snowflake size={16} /> {streak.freezesOwned} freeze{streak.freezesOwned === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

export function Path() {
  // remembered on this device, so a learner on Read & Write comes back to it
  // after a lesson and after reopening the app
  const track = useApp((s) => s.pathTrack);
  const setTrack = useApp((s) => s.setPathTrack);
  const units = trackUnits(track);
  const profile = useApp((s) => s.profile);
  const unitProgress = useApp((s) => s.unitProgress);
  // theme the backdrop by the section the learner is currently working in
  const startSection = track === 'speak' ? (profile?.startSection ?? 0) : 0;
  const incomplete = (u: Unit) => {
    const up = unitProgress[u.id];
    return !up || !u.lessons.every((l) => up.lessonsDone.includes(l.id));
  };
  const activeUnit =
    units.find((u) => u.section >= startSection && incomplete(u)) ?? units.find(incomplete) ?? units[units.length - 1];
  let lastSection = -1;

  // Land the learner at their next lesson instead of the top of the course.
  // Runs on arrival at home and on track switch — not on every progress tick.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const node =
        document.querySelector('[data-current-lesson]') ?? document.getElementById(`unit-${activeUnit?.id}`);
      if (!node) return;
      const dist = Math.abs(node.getBoundingClientRect().top - window.innerHeight / 2);
      if (dist < 100) return; // already in view
      // long jumps teleport (smooth-scrolling 40 units looks like a slot
      // machine); short hops glide
      node.scrollIntoView({ block: 'center', behavior: dist > 2400 ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);
  return (
    <div className="flex flex-col gap-8">
      <FullJungle section={activeUnit?.section ?? 1} />
      <Hero />

      {/* pathway switcher: speaking course ⟷ reading & writing course */}
      <div className="surface relative flex p-1">
        {(
          [
            ['speak', 'Speaking', 'మాట్లాడటం'],
            ['script', 'Read & Write', 'చదవడం రాయడం'],
          ] as ['speak' | 'script', string, string][]
        ).map(([t, label, teLabel]) => (
          <button
            key={t}
            onClick={() => setTrack(t)}
            aria-pressed={track === t}
            className={`flex-1 rounded-[18px] px-3 py-2.5 text-center transition-all ${
              track === t ? 'btn-teal text-white shadow-soft' : 'text-ink-soft hover:bg-line/40'
            }`}
          >
            <div className="font-extrabold">{label}</div>
            <div className={`te-script text-xs font-semibold ${track === t ? 'text-white/80' : ''}`}>{teLabel}</div>
          </button>
        ))}
      </div>

      {track === 'script' && <KeyboardHelp />}

      {units.map((u) => {
        const showHeader = u.section !== lastSection;
        lastSection = u.section;
        const meta = SECTION_META[track]?.[u.section] ?? { title: `Section ${u.section}`, color: 'text-teal', emoji: '📚' };
        return (
          <Fragment key={u.id}>
            {showHeader && (
              <div className="relative mt-2 overflow-hidden rounded-[22px] py-5 shadow-soft">
                <JungleCanopy section={u.section} />
                <div className="relative text-center">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-ink-soft">
                    {u.section === 0 ? 'Start here · Section 0' : `Section ${u.section}`}
                  </div>
                  <h2 className={`text-xl font-extrabold ${meta.color} drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]`}>
                    {meta.emoji} {meta.title}
                  </h2>
                </div>
              </div>
            )}
            <UnitBlock unit={u} />
          </Fragment>
        );
      })}
      <div className="relative flex flex-col items-center gap-2 py-8 text-center">
        <Mascot pose="sleepy" size={90} />
        <p className="font-bold text-ink-soft">
          {track === 'speak'
            ? `That's the whole speaking course, ${profile?.name ?? 'friend'} — finish it and you're Hyderabad-ready!`
            : 'Master these and you can read any sign in Hyderabad.'}
        </p>
      </div>
    </div>
  );
}
