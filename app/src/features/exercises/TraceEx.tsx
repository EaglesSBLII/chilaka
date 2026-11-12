// Handwriting exercise: draw the letter (or a short word) with a finger,
// Apple Pencil or mouse.
//  - Guided: trace over a faint guide that fills with colour as it is covered;
//    scored by shape (engine/trace.ts) and finished automatically.
//  - From memory: hear it, write it on a blank sheet, then compare with the
//    real letter and say whether you got it (handwriting cannot be judged
//    reliably against a font, so the learner is the judge).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Eraser, Eye, Undo2, Volume2, X } from 'lucide-react';
import { playItemAudio, playItemAudioAfterPause } from '../../audio';
import { isComputer } from '../../device';
import { haptic } from '../../haptics';
import { TRACE_RULES, aksharaCount, centreStrokes, scoreTrace, type Pt, type TraceMask } from '../../engine/trace';
import type { TraceExercise } from '../../engine/types';
import { Button } from '../../components/ui';
import type { ExerciseProps } from './shared';

const GRID_H = 96; // scoring grid height; width follows the sheet's shape
const FONT_WEIGHT = 600;

interface Geometry {
  w: number; // sheet size, CSS px
  h: number;
  fontPx: number;
  x: number; // text origin (alphabetic baseline, left)
  y: number;
  font: string;
  mask: TraceMask;
  scale: number; // CSS px → grid cells
}

interface Palette {
  ink: string;
  guide: string;
  accent: string;
  success: string;
}
function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim() || '#000';
  return { ink: v('--c-ink'), guide: v('--c-ink-soft'), accent: v('--c-accent'), success: v('--c-success') };
}

/** Lay the text out on a w×h sheet and rasterise it into the scoring mask. */
export function layoutTrace(te: string, w: number, h: number): Geometry | null {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe || w < 40 || h < 40) return null;
  const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  let fontPx = h * 0.6;
  const fontOf = (px: number) => `${FONT_WEIGHT} ${px}px ${family}`;
  probe.font = fontOf(fontPx);
  let m = probe.measureText(te);
  const inkW = () => m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const inkH = () => m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  // size the letter to fill the sheet with a comfortable margin: a big target for a finger
  const fit = Math.min((w * 0.8) / Math.max(1, inkW()), (h * 0.6) / Math.max(1, inkH()));
  fontPx *= fit;
  probe.font = fontOf(fontPx);
  m = probe.measureText(te);
  const x = (w - inkW()) / 2 + m.actualBoundingBoxLeft;
  const y = (h - inkH()) / 2 + m.actualBoundingBoxAscent;

  const scale = GRID_H / h;
  const gw = Math.max(8, Math.round(w * scale));
  const off = document.createElement('canvas');
  off.width = gw;
  off.height = GRID_H;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (!octx) return null;
  const raster = (text: string): { data: Uint8Array; any: boolean } => {
    octx.clearRect(0, 0, gw, GRID_H);
    octx.font = fontOf(fontPx * scale);
    octx.fillStyle = '#000';
    octx.fillText(text, x * scale, y * scale);
    const px = octx.getImageData(0, 0, gw, GRID_H).data;
    const bits = new Uint8Array(gw * GRID_H);
    let any = false;
    for (let i = 0; i < bits.length; i++) {
      if (px[i * 4 + 3] > 96) {
        bits[i] = 1;
        any = true;
      }
    }
    return { data: bits, any };
  };
  // a device with no Telugu font draws every letter as the same "missing" box:
  // compare with a code point that is unassigned in the Telugu block
  const missing = raster('\u0C0D'.repeat([...te].length)).data;
  const { data, any } = raster(te);
  if (!any || data.every((v, i) => v === missing[i])) return null;
  off.width = 0; // release the scratch canvas (iOS keeps canvas memory around)
  return { w, h, fontPx, x, y, font: fontOf(fontPx), mask: { w: gw, h: GRID_H, data }, scale };
}

/** A smooth line through the points (quadratic through the midpoints), like a pen. */
function drawStroke(ctx: CanvasRenderingContext2D, pts: Pt[], width: number): void {
  if (pts.length === 0) return;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export function TraceEx({ exercise, item, phase, lastEval, onReady, onAutoResult, onSkip }: ExerciseProps) {
  const guideWanted = (exercise as TraceExercise).guide;
  const reduce = useReducedMotion();
  const single = aksharaCount(item.te) === 1;
  const computer = isComputer();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fillRef = useRef<HTMLCanvasElement | null>(null); // offscreen: the coloured part of the guide
  const geo = useRef<Geometry | null>(null);
  const strokes = useRef<Pt[][]>([]);
  const active = useRef<{ id: number; pts: Pt[] } | null>(null);
  const frame = useRef(0);
  const doneTimer = useRef(0);
  const lastLive = useRef(0);
  const palette = useRef<Palette | null>(null);
  const solvedRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [revealed, setRevealed] = useState(false); // from memory: comparing with the real letter
  const [progress, setProgress] = useState(0);
  const [hasInk, setHasInk] = useState(false);
  const [solved, setSolved] = useState(false);
  const [noFont, setNoFont] = useState(false);
  const [offLetter, setOffLetter] = useState(false); // covered, but too much ink away from the letter
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  // show the answer once it has been judged wrong
  const showAnswer = phase === 'feedback' && lastEval?.correct === false;
  const showAnswerRef = useRef(showAnswer);
  showAnswerRef.current = showAnswer;

  const paint = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const g = geo.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !g || !ctx) return;
    const dpr = canvas.width / g.w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const all = active.current ? [...strokes.current, active.current.pts] : strokes.current;
    const done = solvedRef.current;
    const compare = revealedRef.current;
    const colours = (palette.current ??= readPalette());
    const withGuide = guideWanted || compare || showAnswerRef.current || done;

    if (withGuide) {
      ctx.font = g.font;
      ctx.globalAlpha = done ? 1 : compare ? 0.38 : 0.2;
      ctx.fillStyle = done ? colours.success : compare ? colours.accent : colours.guide;
      ctx.fillText(item.te, g.x, g.y);
      ctx.globalAlpha = 1;
    }
    if (guideWanted && !done && all.length > 0) {
      // the part of the guide that has ink near it, in the accent colour
      const fill = (fillRef.current ??= document.createElement('canvas'));
      if (fill.width !== canvas.width || fill.height !== canvas.height) {
        fill.width = canvas.width;
        fill.height = canvas.height;
      }
      const f = fill.getContext('2d');
      if (f) {
        f.setTransform(dpr, 0, 0, dpr, 0, 0);
        f.globalCompositeOperation = 'source-over';
        f.clearRect(0, 0, g.w, g.h);
        f.lineCap = 'round';
        f.lineJoin = 'round';
        f.strokeStyle = '#000';
        f.fillStyle = '#000';
        const reach = (2 * TRACE_RULES.coverRadius * GRID_H) / g.scale; // same reach the scorer uses
        for (const s of all) drawStroke(f, s, reach);
        f.globalCompositeOperation = 'source-in';
        f.font = g.font;
        f.fillStyle = colours.accent;
        f.fillText(item.te, g.x, g.y);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(fill, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    // the learner's own ink on top
    if (done) return; // finished: just the clean letter
    ctx.strokeStyle = colours.ink;
    ctx.fillStyle = colours.ink;
    ctx.globalAlpha = guideWanted ? 0.55 : 0.9;
    const width = Math.max(5, g.h * 0.026);
    for (const s of all) drawStroke(ctx, s, width);
    ctx.globalAlpha = 1;
  }, [item.te, guideWanted]);

  const requestPaint = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const score = useCallback((withActive = false) => {
    const g = geo.current;
    if (!g) return { coverage: 0, accuracy: 0, pass: false };
    const all = withActive && active.current ? [...strokes.current, active.current.pts] : strokes.current;
    return scoreTrace(g.mask, all.map((s) => s.map((p) => ({ x: p.x * g.scale, y: p.y * g.scale }))));
  }, []);

  /** After the ink changed: update the meter, offer Check, auto-finish a completed guided trace. */
  const judge = useCallback(() => {
    const any = strokes.current.length > 0;
    setHasInk(any);
    if (!guideWanted) {
      onReady(null); // from memory is compared by eye, not scored
      return;
    }
    if (!any) {
      setProgress(0);
      setOffLetter(false);
      onReady(null);
      return;
    }
    const r = score();
    setProgress(r.coverage);
    // the letter is covered but the ink strays: say so, or the full meter looks stuck
    setOffLetter(!r.pass && r.coverage >= TRACE_RULES.minCoverage);
    if (r.pass && !solvedRef.current) {
      solvedRef.current = true;
      setSolved(true);
      onReady(null);
      requestPaint();
      haptic('success');
      doneTimer.current = window.setTimeout(() => onAutoResult({ correct: true, expected: item.te }), reduce ? 80 : 420);
      return;
    }
    onReady(() => ({ correct: score().pass, expected: item.te }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideWanted, item.te, reduce, requestPaint, score]);

  // (re)build the sheet whenever its size changes
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const build = () => {
      const w = Math.round(wrap.clientWidth);
      const h = Math.round(Math.min(w, 340) * (single ? 1 : 0.74));
      if (geo.current && geo.current.w === w && geo.current.h === h) return;
      const g = layoutTrace(item.te, w, h);
      setNoFont(!g);
      if (!g) return;
      if (geo.current && strokes.current.length > 0 && !solvedRef.current) {
        // the sheet changed shape (rotation, window resize): the letter moved,
        // so old ink no longer lies on it. Start the sheet again.
        strokes.current = [];
        active.current = null;
        setHasInk(false);
        setProgress(0);
        setOffLetter(false);
        onReady(null);
      }
      geo.current = g;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      paint();
    };
    build();
    const ro = new ResizeObserver(build);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      // hand the bitmap memory back now (iOS frees canvases lazily)
      canvas.width = 0;
      canvas.height = 0;
      if (fillRef.current) fillRef.current.width = 0;
      geo.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.te, single, paint]);

  // iOS: stop the long-press loupe / text selection starting from the sheet
  // (React's pointer handlers cannot cancel the touch defaults)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const block = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener('touchstart', block, { passive: false });
    return () => canvas.removeEventListener('touchstart', block);
  }, []);

  // light / dark switch while the sheet is open: re-read the colours
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const flip = () => {
      palette.current = null;
      requestPaint();
    };
    mq.addEventListener('change', flip);
    return () => mq.removeEventListener('change', flip);
  }, [requestPaint]);

  // a new exercise: clean sheet, say the letter
  useEffect(() => {
    strokes.current = [];
    active.current = null;
    solvedRef.current = false;
    setSolved(false);
    setRevealed(false);
    setProgress(0);
    setOffLetter(false);
    setHasInk(false);
    palette.current = null;
    onReady(null);
    requestPaint();
    const cancel = playItemAudioAfterPause(item.id);
    return () => {
      cancel();
      window.clearTimeout(doneTimer.current); // leaving mid-celebration must not grade a gone exercise
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  useEffect(() => {
    requestPaint();
  }, [revealed, showAnswer, solved, requestPaint]);

  // test hook: known-good strokes for the current sheet, in viewport coordinates
  useEffect(() => {
    const w = window as unknown as { __traceGuideStrokes?: () => Pt[][] };
    w.__traceGuideStrokes = () => {
      const g = geo.current;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!g || !rect) return [];
      return centreStrokes(g.mask).map((s) => s.map((p) => ({ x: rect.left + p.x / g.scale, y: rect.top + p.y / g.scale })));
    };
    return () => {
      delete w.__traceGuideStrokes;
    };
  }, []);

  const locked = () => phaseRef.current !== 'answering' || solvedRef.current || revealedRef.current || !geo.current;
  const at = (e: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const extend = (p: Pt) => {
    const pts = active.current!.pts;
    const last = pts[pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.8) pts.push(p);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (locked() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (active.current) {
      // a second finger or palm while drawing is ignored; but a stroke whose end
      // never arrived (app switch, system gesture) must not block the sheet forever
      if (e.isPrimary && e.pointerId !== active.current.id) active.current = null;
      else return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    active.current = { id: e.pointerId, pts: [at(e)] };
    requestPaint();
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active.current || active.current.id !== e.pointerId) return;
    e.preventDefault();
    // every sample the screen took since the last frame (120 Hz, Apple Pencil)
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    if (samples.length > 0) for (const s of samples) extend(at(s));
    else extend(at(e));
    requestPaint();
    // the meter follows the pen while it moves (the verdict waits for the lift)
    if (guideWanted && e.timeStamp - lastLive.current > 110) {
      lastLive.current = e.timeStamp;
      setProgress(score(true).coverage);
    }
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active.current || active.current.id !== e.pointerId) return;
    strokes.current = [...strokes.current, active.current.pts];
    active.current = null;
    requestPaint();
    judge();
  };
  // the system took the touch away (a gesture, an alert): that was not a stroke
  const onCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active.current || active.current.id !== e.pointerId) return;
    active.current = null;
    requestPaint();
    judge();
  };

  const undo = () => {
    if (locked()) return;
    strokes.current = strokes.current.slice(0, -1);
    requestPaint();
    judge();
  };
  const clear = () => {
    if (locked()) return;
    strokes.current = [];
    requestPaint();
    judge();
  };
  const compare = () => {
    if (locked() || strokes.current.length === 0) return;
    revealedRef.current = true;
    setRevealed(true);
    haptic();
  };
  const gradeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // the two answer buttons can sit below the fold on a small phone
    if (revealed) gradeRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [revealed, reduce]);
  const grade = (correct: boolean) => onAutoResult({ correct, expected: item.te });

  const tool =
    'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-card/80 px-3 text-sm font-bold text-ink-soft shadow-press backdrop-blur transition-transform active:scale-95 disabled:opacity-40';
  const what = single ? 'letter' : 'word';
  // full when the letter counts as covered
  const meter = Math.round((solved ? 1 : Math.min(progress / TRACE_RULES.minCoverage, 1)) * 100);

  return (
    <div className="flex flex-col gap-4" data-trace-mode={guideWanted ? 'guided' : 'memory'}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold">{guideWanted ? `Trace the ${what}` : 'Write it from memory'}</h2>
          <p className="text-sm font-semibold text-ink-soft">
            {guideWanted
              ? `Draw over the guide with your ${computer ? 'mouse or trackpad' : 'finger'}.`
              : `Listen, then write the ${what} for “${item.roman}”.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void playItemAudio(item.id)}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal text-white shadow-soft transition-transform active:scale-90"
          aria-label="Play audio"
        >
          <Volume2 size={22} />
        </button>
      </div>

      <motion.div
        ref={wrapRef}
        className="surface relative overflow-hidden rounded-[28px]"
        animate={solved && !reduce ? { scale: [1, 1.035, 1] } : { scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* ruled lines, like a writing sheet */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-1/2 border-t border-dashed border-line" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-6 left-1/2 border-l border-dashed border-line" />
        <canvas
          ref={canvasRef}
          data-testid="trace-canvas"
          role="img"
          aria-label={guideWanted ? `Trace ${item.te}` : `Write the ${what} you hear`}
          className="relative block w-full cursor-crosshair select-none"
          style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onLostPointerCapture={onCancel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {noFont && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm font-semibold text-ink-soft">
            This device has no Telugu font, so the {what} cannot be shown here. Skip this one below.
          </p>
        )}
      </motion.div>

      <div className="flex items-center justify-between">
        <div className="flex shrink-0 gap-2">
          <button type="button" className={tool} onClick={undo} disabled={!hasInk || phase !== 'answering' || solved || revealed} aria-label="Undo">
            <Undo2 size={18} />
          </button>
          <button type="button" className={tool} onClick={clear} disabled={!hasInk || phase !== 'answering' || solved || revealed} aria-label="Clear">
            <Eraser size={18} />
          </button>
        </div>
        {!guideWanted && !revealed && phase === 'answering' && (
          <button
            type="button"
            className={`${tool} ${hasInk ? 'bg-teal! text-white!' : ''}`}
            onClick={compare}
            disabled={!hasInk}
          >
            <Eye size={18} /> Compare
          </button>
        )}
        {guideWanted && (
          <div
            className="ml-4 h-1.5 flex-1 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-label="Traced"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={meter}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none ${solved ? 'bg-success' : 'bg-accent'}`}
              style={{ width: `${meter}%` }}
            />
          </div>
        )}
      </div>

      {!guideWanted && revealed && phase === 'answering' && (
        <div ref={gradeRef} className="flex flex-col gap-2">
          <p className="text-center text-sm font-bold text-ink-soft">Does your writing match the {what}?</p>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => grade(false)}>
              <span className="inline-flex items-center gap-2">
                <X size={18} /> Not yet
              </span>
            </Button>
            <Button variant="success" className="flex-[1.4]" onClick={() => grade(true)}>
              <span className="inline-flex items-center gap-2">
                <Check size={18} /> I got it
              </span>
            </Button>
          </div>
        </div>
      )}
      {guideWanted && offLetter && phase === 'answering' && (
        <p className="text-center text-sm font-bold text-flame" role="status">
          Stay on the lines: clear it and trace the {what} once.
        </p>
      )}
      {computer && !noFont && phase === 'answering' && !solved && (
        <p className="text-center text-xs font-semibold text-ink-soft">
          Drawing is easier with a finger on a phone. On a computer you can press Skip.
        </p>
      )}
      {onSkip && phase === 'answering' && !solved && !revealed && (noFont || !computer) && (
        // a way through for anyone who cannot draw right now (VoiceOver, a hurt hand, no Telugu font)
        <button type="button" className="self-center text-xs font-semibold text-ink-soft underline" onClick={onSkip}>
          {noFont ? 'Skip this one' : 'Can’t draw right now? Skip'}
        </button>
      )}
    </div>
  );
}
