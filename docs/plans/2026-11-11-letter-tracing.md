# Letter tracing (Reading & Writing track)

Goal: learners draw each Telugu letter with a finger (or Apple Pencil / mouse), first over a
guide and later from memory. It must feel like a native iOS drawing surface.

## Design
- New exercise kind `trace` (`guide: boolean`). Generated only for script-track items of at
  most 3 aksharas with no space (`isTraceable`): single letters and short words. Longer items
  and recap rows fall back to the keyboard exercise.
  - Meet step (first time a letter is met): card -> **trace over the guide** -> pick by ear.
  - Produce step: `trace` from memory (guide hidden) is every other exercise, taking turns with
    type-script / wordbank, so about half the letters of a lesson are written from memory.
  - The finale stays `type-script`.
- Guided scoring is shape based (no stroke-order data exists for Telugu). The letter is
  rendered with the device's own Telugu font into a small mask; the drawing is compared with it:
  - coverage = share of the letter that has ink near it,
  - accuracy = share of the ink that lies near the letter.
  A guided trace finishes by itself as soon as both are high enough.
- From memory is **self-checked**: write on a blank sheet, press Compare to see the real letter
  under your writing, then choose "I got it" or "Not yet" (a miss comes back later like any
  wrong answer). Measured in a real browser font, shape overlap cannot tell one freehand Telugu
  letter from another (56-96% of letter pairs were confused at any tolerance that accepts real
  handwriting), so the app does not pretend to grade it.
- Known limit of guided scoring: dense hatching inside the letter's own box passes, because it
  is the same amount of ink as writing a Telugu letter twice.
- Pure engine in `src/engine/trace.ts` (unit tested with synthetic masks; real letters are
  cross-checked in the browser by `tests/e2e/trace.spec.ts`).
- Surface `src/features/exercises/TraceEx.tsx`: pointer events with coalesced samples,
  smoothed round strokes, hi-DPI canvas, the guide fills with the accent colour as it is
  traced, undo / clear, audio, auto-pass when the letter is covered, reduced-motion aware.
- Computers (mouse or trackpad as the main pointer, or the Mac app): tracing still works with a
  mouse, and a **Skip** button is shown in the footer (no penalty, no XP).
- Phones and tablets get no footer Skip, only a small "Can't draw right now? Skip" link, so
  nobody who cannot draw (VoiceOver, an injured hand, a device with no Telugu font) is stuck.

## Verification
- vitest: scorer (perfect / wobbly / partial / scribble / offset), akshara counting,
  generator placement.
- Playwright: draw real letters with pointer input on a touch device profile; for every
  traceable item of the course in the real font: its own centre line passes (also with an
  unsteady hand), half of it fails, a scribble over the sheet fails; Skip on desktop.
- Full existing suites stay green.
