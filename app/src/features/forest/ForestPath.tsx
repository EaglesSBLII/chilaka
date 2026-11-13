// The forest map: the lesson path drawn as a climb between two great trees.
// Lessons are perches on branches joined by rope bridges; Chikki sits on the
// current perch and flies to the next one when a lesson is finished.
//
// Design notes, research and removal steps: docs/plans/2026-11-12-forest-map.md
// Same content, rules, button names and texts as the classic features/Path.tsx.

import { devOpen } from '../../devMode';
import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  BookOpen,
  Bus,
  Check,
  ClipboardList,
  Crown,
  Flame,
  Hand,
  Heart,
  House,
  Leaf,
  Lock,
  MessageSquareText,
  MessagesSquare,
  PenLine,
  Play,
  Sprout,
  Star,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { useApp, useUnitStatus } from '../../store';
import { trackUnits } from '../../content/load';
import { Mascot, useMascotOutfit } from '../../components/Mascot';
import { Ring } from '../../components/ui';
import { KeyboardHelp } from '../exercises/KeyboardHelp';
import { Hero, SECTION_META } from '../Path';
import type { Unit } from '../../engine/types';
import { Bunting, ForestBackdrop, ForestDefs, GateArt, TRUNK_VARS, UnitScenery } from './art';
import { BIRD_FEET, SmallChikki } from './Bird';
import { flightPlan, MAX_WIDTH, metrics, NODE_R, perchPoint, unitLayout, type FlightPlan, type Metrics, type Side } from './layout';
import { findCurrent, flightOrigin, lessonStates, nextStartSide, type NodeState, type PerchRef, type UnitStatus } from './model';
import './forest.css';

type Track = 'speak' | 'script';

/**
 * Remembered while the app stays open (never stored, never synced): the track
 * the learner was on, and the perch last shown as current on each track. The
 * second is how we know to play the flight after a lesson.
 */
const memory: { track: Track; current: Partial<Record<Track, PerchRef | null>> } = { track: 'speak', current: {} };

const SECTION_ICONS: Record<Track, Record<number, LucideIcon>> = {
  speak: { 0: Hand, 1: Sprout, 2: House, 3: MessagesSquare, 4: Bus, 5: Heart, 6: ClipboardList, 7: Flame, 8: Waves },
  script: { 1: PenLine, 2: BookOpen },
};

/** Flights longer than this are skipped: Chikki just appears. */
const MAX_FLIGHT_PX = 900;

const groveFor = (track: Track, section: number) => (section + (track === 'script' ? 3 : 0)) % 6;

// ------------------------------------------------------------------ a unit

interface UnitView {
  unit: Unit;
  status: UnitStatus;
  states: NodeState[];
  dialogueDone: boolean;
  startSide: Side;
  grove: number;
  /** the unit after this one is reachable (or this is the last unit and it is finished) */
  exitOpen: boolean;
}

const TOKEN_CLASS: Record<NodeState, string> = {
  done: 'is-done',
  current: 'is-current',
  replayable: 'is-replayable',
  locked: 'is-locked',
};

const ForestUnit = memo(function ForestUnit({
  view,
  m,
  near,
  birdLesson,
  landing,
  outfit,
}: {
  view: UnitView;
  m: Metrics;
  /** close enough to the viewport to draw the scenery */
  near: boolean;
  /** the lesson Chikki is perched on in this unit, if any */
  birdLesson: string | null;
  landing: boolean;
  outfit: ReturnType<typeof useMascotOutfit>;
}) {
  const navigate = useApp((s) => s.navigate);
  const { unit, status, states, dialogueDone, startSide, grove, exitOpen } = view;
  const hasDialogue = Boolean(unit.dialogue);
  const count = unit.lessons.length + (hasDialogue ? 1 : 0);
  const layout = useMemo(() => unitLayout(count, startSide, m), [count, startSide, m]);
  const locked = status === 'locked';
  const doneCount = states.filter((s) => s === 'done').length;
  const open = useMemo(() => [...states.map((s) => s !== 'locked'), ...(hasDialogue ? [!locked] : [])], [states, hasDialogue, locked]);
  const birdIndex = birdLesson ? unit.lessons.findIndex((l) => l.id === birdLesson) : -1;
  const birdNode = birdIndex >= 0 ? layout.nodes[birdIndex] : null;
  return (
    <div id={`unit-${unit.id}`} className={`fg fg-${grove}`}>
      {/* the unit's sign, hung on a bamboo pole strung between the two trees */}
      <div className={`f-sign-wrap ${locked ? 'is-locked' : ''}`}>
        <div className="f-pole" />
        {status === 'done' && <Bunting width={m.width - 28} />}
        <div className="f-sign">
          <Ring pct={doneCount / unit.lessons.length} size={44} stroke={5} color={status === 'done' ? 'var(--c-accent)' : 'var(--c-teal)'}>
            {status === 'done' ? (
              <Crown size={18} className="text-accent-dark" />
            ) : (
              <span className="text-[11px] font-extrabold text-ink-soft">
                {doneCount}/{unit.lessons.length}
              </span>
            )}
          </Ring>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="text-lg font-extrabold leading-tight">{unit.title}</h3>
              {unit.teTitle && <div className="te-script text-sm font-bold text-teal">{unit.teTitle}</div>}
            </div>
            <p className="text-sm font-semibold leading-snug text-ink-soft">{unit.description}</p>
          </div>
        </div>
      </div>

      <div className="f-area" data-forest-unit={unit.id} style={{ height: layout.height }}>
        {near && (
          <UnitScenery
            unitId={unit.id}
            m={m}
            layout={layout}
            open={open}
            hutIndex={hasDialogue ? count - 1 : -1}
            entryOpen={!locked}
            exitOpen={exitOpen}
            lit={!locked}
          />
        )}
        {unit.lessons.map((l, i) => {
          const state = states[i];
          const n = layout.nodes[i];
          return (
            <button
              key={l.id}
              disabled={state === 'locked'}
              data-current-lesson={state === 'current' ? 'true' : undefined}
              data-perch={`${unit.id}/${l.id}`}
              data-state={state}
              aria-label={`${unit.title} lesson ${i + 1}`}
              onClick={() => navigate({ name: 'lesson', unitId: unit.id, lessonId: l.id })}
              className={`f-token ${TOKEN_CLASS[state]}`}
              style={{ left: n.x, top: n.y }}
            >
              {state === 'done' && <span className="sr-only">✓</span>}
              {state === 'done' ? (
                <Check size={30} strokeWidth={3} />
              ) : state === 'locked' ? (
                <Lock size={23} />
              ) : state === 'current' ? (
                <Play size={27} className="ml-1 fill-white" />
              ) : (
                <Star size={26} className="fill-white/90" />
              )}
              {state === 'current' && <span className="f-start">START</span>}
            </button>
          );
        })}
        {hasDialogue && (
          <button
            disabled={locked}
            onClick={() => navigate({ name: 'dialogue', unitId: unit.id })}
            aria-label={`${unit.title} dialogue`}
            className={`f-token is-hut ${dialogueDone ? 'is-done' : locked ? 'is-locked' : 'is-talk'}`}
            style={{ left: layout.nodes[count - 1].x, top: layout.nodes[count - 1].y }}
          >
            <MessageSquareText size={27} />
          </button>
        )}
        {birdNode && (
          <div
            className="f-perched"
            style={{ transform: `translate(${birdNode.x - BIRD_FEET[0]}px, ${birdNode.y - NODE_R - BIRD_FEET[1] + 5}px)` }}
          >
            <SmallChikki pose="perch" facing={birdNode.side === 'L' ? 1 : -1} outfit={outfit} landing={landing} />
          </div>
        )}
      </div>
    </div>
  );
});

// ------------------------------------------------------------------ screen

export function ForestPath() {
  // the same device-local choice the classic path uses, so the track survives lessons and reloads
  const track = useApp((st) => st.pathTrack) as Track;
  const setTrack = useApp((st) => st.setPathTrack);
  const units = trackUnits(track);
  const profile = useApp((s) => s.profile);
  const unitProgress = useApp((s) => s.unitProgress);
  const statusOf = useUnitStatus();
  const outfit = useMascotOutfit();
  const reduceMotion = useReducedMotion();

  // ---- width of the column → metrics
  const colRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => Math.min(MAX_WIDTH, typeof window === 'undefined' ? 390 : window.innerWidth));
  useEffect(() => {
    const col = colRef.current;
    if (!col) return;
    const measure = () => setWidth(col.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(col);
    return () => ro.disconnect();
  }, []);
  const m = useMemo(() => metrics(width), [width]);

  // ---- what every unit looks like (same rules as the classic path)
  // the placement start section only applies to the speaking course
  const startSection = track === 'speak' ? (profile?.startSection ?? 1) : 1;
  const { views, current } = useMemo(() => {
    const statuses = units.map((u) => statusOf(u.id) as UnitStatus);
    const stateMap = new Map<string, NodeState[]>();
    let side: Side = 'L';
    const out: UnitView[] = units.map((unit, i) => {
      const up = unitProgress[unit.id];
      const states = lessonStates(unit, statuses[i], up?.lessonsDone ?? [], startSection);
      stateMap.set(unit.id, states);
      const startSide = side;
      side = nextStartSide(side, unit.lessons.length + (unit.dialogue ? 1 : 0));
      const next = statuses[i + 1];
      return {
        unit,
        status: devOpen(statuses[i]),
        states,
        dialogueDone: up?.dialogueDone ?? false,
        startSide,
        grove: groveFor(track, unit.section),
        exitOpen: next ? devOpen(next) !== 'locked' : statuses[i] === 'done',
      };
    });
    return { views: out, current: findCurrent(units, stateMap) };
    // statusOf is rebuilt from profile + unitProgress on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, unitProgress, profile, startSection]);
  const currentKey = current ? `${current.unitId}/${current.lessonId}` : '';

  // ---- scenery is only drawn for units near the viewport
  const [near, setNear] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const col = colRef.current;
    if (!col || typeof IntersectionObserver === 'undefined') {
      setNear(null); // null = draw everything
      return;
    }
    const seen = new Set<string>();
    setNear(seen);
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.forestUnit!;
          if (e.isIntersecting ? !seen.has(id) : seen.has(id)) {
            if (e.isIntersecting) seen.add(id);
            else seen.delete(id);
            changed = true;
          }
        }
        if (changed) setNear(new Set(seen));
      },
      { rootMargin: '900px 0px 900px 0px' },
    );
    col.querySelectorAll<HTMLElement>('[data-forest-unit]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [track]);

  // ---- arriving: jump to the current perch, and fly there if a lesson was just finished
  const [flight, setFlight] = useState<{ plan: FlightPlan; phase: 'ready' | 'fly' } | null>(null);
  const [landing, setLanding] = useState(false);
  const arrivedTrack = useRef<Track | null>(null);
  useEffect(() => {
    if (arrivedTrack.current === track) {
      // progress changed while we were looking (e.g. sync): nothing to animate
      memory.current[track] = current;
      return;
    }
    const timers: number[] = [];
    // everything, including remembering the perch, waits for the first frame:
    // React's development double-run of effects is cancelled before it
    const raf = requestAnimationFrame(() => {
      arrivedTrack.current = track;
      const prev = memory.current[track] ?? null;
      memory.current[track] = current;
      const origin = reduceMotion
        ? null
        : flightOrigin(prev, current, (ref) => Boolean(useApp.getState().unitProgress[ref.unitId]?.lessonsDone.includes(ref.lessonId)));
      const col = colRef.current;
      if (!col) return;
      // Land the learner at their next lesson instead of the top of the
      // course. Always a jump, never a smooth scroll, so nothing is moving
      // when the learner (or a test) reaches for a button.
      const target = col.querySelector<HTMLElement>('[data-current-lesson]') ?? (current ? null : col.querySelector<HTMLElement>('[data-forest-end]'));
      if (target && Math.abs(target.getBoundingClientRect().top + 32 - window.innerHeight / 2) >= 100) {
        target.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
      if (!origin || !current) return;
      const a = col.querySelector<HTMLElement>(`[data-perch="${origin.unitId}/${origin.lessonId}"]`);
      const b = col.querySelector<HTMLElement>(`[data-perch="${current.unitId}/${current.lessonId}"]`);
      if (!a || !b) return;
      const c = col.getBoundingClientRect();
      const centre = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top };
      };
      const from = perchPoint(centre(a));
      const to = perchPoint(centre(b));
      if (Math.hypot(to.x - from.x, to.y - from.y) > MAX_FLIGHT_PX) return;
      setFlight({ plan: flightPlan(from, to), phase: 'ready' });
      // a beat on the old perch so the learner sees where Chikki was
      timers.push(window.setTimeout(() => setFlight((f) => (f ? { ...f, phase: 'fly' } : f)), 450));
    });
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
      setFlight(null);
    };
    // runs on arrival and on track switch, and to remember the current perch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, currentKey]);

  const onLanded = () => {
    setFlight(null);
    setLanding(true);
    window.setTimeout(() => setLanding(false), 600);
  };

  let lastSection = -1;
  return (
    <div className="flex flex-col gap-8">
      {createPortal(<ForestBackdrop />, document.body)}
      <Hero />

      {/* pathway switcher: speaking course ⟷ reading & writing course */}
      <div className="surface relative flex p-1">
        {(
          [
            ['speak', 'Speaking', 'మాట్లాడటం'],
            ['script', 'Read & Write', 'చదవడం రాయడం'],
          ] as [Track, string, string][]
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

      <div
        className="forest-map forest-vars"
        data-testid="forest-map"
        data-track={track}
        data-chikki-at={flight ? '' : currentKey}
        data-flight={flight ? flight.phase : 'none'}
      >
        <ForestDefs />
        <div ref={colRef} className="f-col" style={{ ...TRUNK_VARS, '--f-trunk-w': `${m.trunk}px` } as CSSProperties}>
          {views.map((view) => {
            const u = view.unit;
            const showGate = u.section !== lastSection;
            lastSection = u.section;
            const meta = SECTION_META[track]?.[u.section] ?? { title: `Section ${u.section}`, color: 'text-teal' };
            const Icon = SECTION_ICONS[track]?.[u.section] ?? Leaf;
            const birdHere = !flight && current?.unitId === u.id ? current.lessonId : null;
            return (
              <Fragment key={u.id}>
                {showGate && (
                  <div className={`f-gate fg fg-${view.grove} ${view.status === 'locked' ? 'is-locked' : ''}`}>
                    <GateArt m={m} seed={u.section + (track === 'script' ? 40 : 0)} />
                    <div className="f-plaque">
                      <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-ink-soft">
                        {u.section === 0 ? 'Start here · Section 0' : `Section ${u.section}`}
                      </div>
                      <h2 className={`flex items-center justify-center gap-2 text-xl font-extrabold leading-tight ${meta.color}`}>
                        <Icon size={20} strokeWidth={2.6} className="shrink-0" aria-hidden="true" />
                        <span>{meta.title}</span>
                      </h2>
                    </div>
                  </div>
                )}
                <ForestUnit
                  view={view}
                  m={m}
                  near={near === null || near.has(u.id)}
                  birdLesson={birdHere}
                  landing={landing && birdHere !== null}
                  outfit={outfit}
                />
              </Fragment>
            );
          })}

          {/* the end of the trail */}
          <div className="f-end fg fg-0" data-forest-end>
            <div className="f-sign flex-col text-center">
              <Mascot pose="sleepy" size={84} />
              <p className="font-bold text-ink-soft">
                {track === 'speak'
                  ? `That's the whole speaking course, ${profile?.name ?? 'friend'} — finish it and you're Hyderabad-ready!`
                  : 'Master these and you can read any sign in Hyderabad.'}
              </p>
            </div>
            <svg className="f-end-art" width={m.width - 28} height="70" viewBox={`0 0 ${m.width - 28} 70`} aria-hidden="true" focusable="false">
              <EndGround width={m.width - 28} />
            </svg>
          </div>

          {/* Chikki in flight: an overlay of its own, so no button ever moves */}
          {flight && (
            <motion.div
              className="f-flyer"
              initial={false}
              style={{ x: flight.plan.xs[0] - BIRD_FEET[0], y: flight.plan.ys[0] - BIRD_FEET[1] + 5 }}
              animate={
                flight.phase === 'fly'
                  ? {
                      x: flight.plan.xs.map((x) => x - BIRD_FEET[0]),
                      y: flight.plan.ys.map((y) => y - BIRD_FEET[1] + 5),
                      rotate: flight.plan.tilts,
                    }
                  : undefined
              }
              transition={{ duration: flight.plan.duration, ease: 'linear' }}
              onAnimationComplete={() => flight.phase === 'fly' && onLanded()}
            >
              <SmallChikki pose={flight.phase === 'fly' ? 'fly' : 'perch'} facing={flight.plan.facing} outfit={outfit} />
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Leafy ground the two trunks grow out of, under the last sign. */
function EndGround({ width: w }: { width: number }) {
  return (
    <g transform="translate(-14 0)">
      <path
        d={`M0 70 V34 C ${w * 0.12} 14, ${w * 0.24} 40, ${w * 0.38} 26 C ${w * 0.5} 14, ${w * 0.62} 38, ${w * 0.76} 24 C ${w * 0.88} 12, ${w * 0.96} 30, ${w + 28} 30 V70 Z`}
        fill="var(--f-l1)"
      />
      <path
        d={`M0 70 V50 C ${w * 0.16} 34, ${w * 0.3} 56, ${w * 0.46} 44 C ${w * 0.6} 34, ${w * 0.74} 56, ${w * 0.9} 44 C ${w * 0.96} 40, ${w + 20} 46, ${w + 28} 48 V70 Z`}
        fill="var(--f-l2)"
      />
      {[0.14, 0.42, 0.7, 0.9].map((t, i) => (
        <use key={t} href="#fx-fern" transform={`translate(${t * w} ${52 - (i % 2) * 6}) rotate(-90) scale(${0.8 + (i % 2) * 0.2})`} />
      ))}
      {[0.28, 0.58, 0.82].map((t) => (
        <use key={t} href="#fx-flower" transform={`translate(${t * w} 42)`} />
      ))}
    </g>
  );
}
