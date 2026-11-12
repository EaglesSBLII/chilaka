# Forest map: the lesson path as a treetop world map

Date: 2026-11-12. Status: built (see "What was built" at the end for anything that differs from the plan).

The owner asked for the pathway to be "in the trees", with Chikki as a small bird sitting on the
learner's current spot and flying to the next one, in a detailed forest scene that borrows what made the
Super Mario world maps good. It also has to be easy to throw away. This document is the research, the plan,
and the removal instructions.

## 1. Research: why those world maps worked

Sources read:

- Radek Koncewicz, "Super Mario Bros. 3 Level Design Lessons, Part 3" (overworld hubs):
  https://www.gamedeveloper.com/design/super-mario-bros-3-level-design-lessons-part-3
  (also at https://significant-bits.com/?p=3432)
- "Touring Super Mario World in 2014" (how World's map differs from SMB3's):
  https://gamedeveloper.com/design/touring-super-mario-world-in-2014
- Super Mario Wiki, "Secret exit" (how World marks levels and exits on the map):
  https://mariowiki.com/Secret_exit
- Wikipedia, "Super Mario Bros. 3" (the map as an overhead view with paths from entrance to castle):
  https://wikipedia.com/wiki/Super_Mario_Bros_3
- New Super Mario Bros. U coverage of the single connected map:
  https://www.siliconera.com/new-super-mario-bros-u-has-a-seamless-world-map-like-super-mario-world/ ,
  https://engadget.com/2012-11-15-new-super-mario-bros-u-review.html ,
  https://digitalchumps.com/2012/11/26/new-super-mario-bros-u-2
- Retroware, "Donkey Kong Country 3: How a Map Makes All the Difference" (a critical view: point-to-point
  maps can be "glorified menus" unless the map reflects the levels and shows distance):
  https://articles.retroware.com/2021/07/30/donkey-kong-country-3-how-a-map-makes-all-the-difference/
- Duolingo's path redesign: https://blog.duolingo.com/new-duolingo-home-screen-design and
  https://www.nbcnews.com/tech/tech-news/duolingos-update-redesign-luis-von-ahn-interview-rcna44655

Principles taken from them, and where each lands in this app:

| # | Principle (source) | In the forest map |
|---|---|---|
| 1 | **The map is a place, not a menu.** SMB3's hubs "connect the game's components into a unified whole"; World gives "the impression of a real world"; NSMBU went back to one contiguous map you can walk end to end. | One continuous climb between two giant trees. The trunks run unbroken behind every unit and section, and the route never stops: it passes behind each unit sign and section gate. |
| 2 | **You move node to node along a route you can see.** SMB3 "showed the routes ahead of time through roads and fixed stage markers". | Every lesson is a perch on a branch. Consecutive perches are joined by a rope-and-plank bridge. Chikki physically sits on the current perch and flies the route to the next one. |
| 3 | **States read at a glance.** World marks stage dots by colour; cleared, open and closed stages look different. | Four token looks: cleared (accent colour, check), current (teal, play icon, glow, Chikki on top, START tag), open for review (teal, star), locked (grey wood, lock, dimmed perch). |
| 4 | **The map changes as you progress.** SMB3: bridges lower, locks vanish, fortresses crumble. World: clearing stages reshapes the terrain. | Bridges are only *built* (ropes and planks) up to the furthest open perch; beyond that there is just a thin bare vine. Finishing a unit hangs bunting on its sign and lights its lanterns. |
| 5 | **Landmarks are milestones.** Fortresses, castles, Toad Houses, airships. | Each unit starts at a sign strung between the trees on a bamboo pole (the unit landmark). Each section starts at a gate: a great bough with a canopy over it and a hanging plaque. The dialogue of a unit is a small roofed tree-house on the route (the "bonus house"). The course ends at a nest. |
| 6 | **Themed regions.** Each SMB3 world has its own look; "a visually different environment" is the reward for finishing a world. | Six grove palettes (leaf colours, blossom, fruit) cycle by section, so passing a gate visibly changes the forest. |
| 7 | **The avatar has presence.** Mario stands on his node and walks the path; the Hammer Bros. wander. | Small Chikki with an idle bob, head tilt and blink; arc flight with wing flaps and a landing squash. Wears the equipped outfit. |
| 8 | **Short loops and anticipation.** You can always see the next few stages and the castle in the distance. | Locked perches and the next sign are visible (dimmed) below the current one, so the next goal is always on screen. The view opens centred on the current perch. |
| 9 | **Small secrets and life.** Toad Houses, hidden pipes, things that move on the map. | Ambient detail scattered deterministically per unit: an owl in a hollow, nests with eggs, shelf mushrooms (they glow at night), mango clusters, lanterns, a tree frog, butterflies, fireflies. No hidden mechanics: this is a study app, nothing may be missable. |
| 10 | **A caution (Retroware; Duolingo backlash):** a point-to-point map is only a pretty menu if it hides information or agency. | The forest map removes nothing: every unit title, description, Telugu title, progress count, section name, both tracks and the keyboard help are still there, and every lesson that was tappable in the classic path is tappable here. The order of content is unchanged (Duolingo-style single path, which the app already had). |

Not copied: no Nintendo characters, sprites, tiles, logos, music or layouts. Only the principles above.
All artwork is original SVG drawn in code.

How this differs from a Duolingo-style path: Duolingo's path is an abstract column of buttons on a flat
colour; position carries no meaning and the mascot stands beside it. Here the route is physical (branches,
bridges), the avatar is *on* the route, and the surroundings change with progress and section.

## 2. Structure and the removal switch

Everything new lives in `app/src/features/forest/`:

| File | What |
|---|---|
| `layout.ts` | Pure geometry: metrics for a width, perch positions for a unit, bridge curves, flight arc, decoration slots. Unit tested. |
| `model.ts` | Pure state: lesson states, which perch is current, whether a flight should play. Unit tested. |
| `pathStyle.ts` | The flag `FOREST_MAP_ENABLED` and the device-local setting (localStorage `chilaka.pathStyle`). |
| `PathSwitch.tsx` | Chooses forest or classic. `PathStyleSetting.tsx` is the Settings card. |
| `art.tsx` | All artwork: shared `<defs>`, backdrop, trunk tiles, unit scenery, section gate. |
| `Bird.tsx` | Small Chikki (perched and flying). |
| `ForestPath.tsx` | The screen. |
| `forest.css` | Palette (day, night, six groves), token styles, animations. |

Touch points outside the folder (the seam), each marked with a `FOREST-MAP SEAM` comment:

1. `app/src/App.tsx`: one import and `<PathSwitch classic={<Path />} />` instead of `<Path />`.
2. `app/src/features/Settings.tsx`: one import and one `<PathStyleSetting />` line.
3. `app/src/features/Path.tsx`: the word `export` added in front of `SECTION_META` and `Hero` so the forest
   screen can reuse them. Nothing else in the classic path changed.

The classic path stays fully working and is what renders when the setting is "Classic" or the flag is false.

### To switch it off without deleting anything

Set `FOREST_MAP_ENABLED = false` in `app/src/features/forest/pathStyle.ts`. The classic path renders for
everyone and the Settings card hides itself.

### To remove it completely

1. Delete the folder `app/src/features/forest/`.
2. In `app/src/App.tsx` remove the `PathSwitch` import and put `{view.name === 'path' && <Path />}` back.
3. In `app/src/features/Settings.tsx` remove the `PathStyleSetting` import and the `<PathStyleSetting />` line.
4. Delete `app/tests/unit/forest-map.test.ts` and `app/tests/e2e/forest-map.spec.ts`.
5. Optional: remove the two `export` keywords in `Path.tsx` (harmless to leave).

Or simply `git revert` the commit that added it. No data, schema, sync or store changes were made, so there
is nothing to migrate back. The only stored value is the localStorage key `chilaka.pathStyle`, which is
ignored once the code is gone.

## 3. Visual design

Layers, back to front:

1. **Backdrop** (fixed to the viewport, one static SVG, portalled to `<body>`): sky gradient, sun and light
   shafts (day) or moon and stars (night), two rows of distant misty trees, low understory. Because it is
   fixed and the map scrolls over it, there is free parallax.
2. **The two great trunks**: a repeating bark tile set as the CSS background of the map column (an SVG data
   URI, a day and a night version). No DOM nodes, always there even where scenery is not mounted.
3. **Unit scenery** (one inline SVG per unit, mounted only near the viewport): trunk details (knots, moss,
   ivy), branches carrying the perches, plank platforms, the bridges, and one decoration on the free side of
   every row. Artwork is defined once as `<g>` in a shared `<defs>` and stamped with `<use>`.
4. **Tokens** (real `<button>`s, same accessible names as the classic path) sitting on the platforms.
5. **Chikki** above the current token.
6. **Signs and gates** in normal document flow between units (HTML text on a wooden sign, SVG ornament).

Layout: perches alternate left tree / right tree all the way down the track (the alternation carries across
units). Row pitch 100 px. The column is the full phone width (it bleeds over the page padding) and at most
560 px on larger screens, centred, with the backdrop filling the rest.

Palette: CSS custom properties on `.forest-map` (`--f-*`), a night set under
`@media (prefers-color-scheme: dark)`, and six grove classes `.fg-0 … .fg-5` that override the leaf,
blossom and fruit colours. SVG fills reference the variables, so day/night and grove changes need no
JavaScript. Tokens keep using the app's existing accent/teal gradients, so shop accent themes still apply.

## 4. Flight

- The forest module remembers, in memory only, the current perch it last showed for each track.
- When the path screen mounts and the current perch is different, and the remembered one is now completed,
  Chikki starts on the old perch and flies to the new one. Otherwise Chikki is simply perched.
- Path: a quadratic arc from perch to perch, apex above both ends, duration 0.7–1.6 s by distance, body
  tilting with the direction of travel, wings flapping (CSS), then a short squash-and-settle on landing.
  Only `transform` is animated. The flying bird is a separate overlay element; no button or ancestor of a
  button is ever animated with a transform (Playwright stability rule).
- On mount the view jumps (no smooth scroll) so the current perch is at the middle of the screen.
- Flights longer than 900 px are skipped (Chikki just appears), as are all flights under
  `prefers-reduced-motion`.
- Nothing is stored or synced for this.

## 5. Accessibility

- Lesson and dialogue controls are real buttons with exactly the classic names (`"<unit title> lesson N"`,
  `"<unit title> dialogue"`), `disabled` when locked, and the visually hidden `✓` when completed.
- All scenery and the bird are `aria-hidden`. Headings stay `h2` (section) and `h3` (unit).
- `prefers-reduced-motion`: no flight, no idle animation, no fireflies/butterfly drift, no glow pulse.
- Text sits on solid sign surfaces, never directly on artwork.

## 6. Performance budget

- Buttons and signs for the whole track are always in the DOM (about 430 buttons on the speaking track).
- Scenery SVG is mounted only for units within about one screen of the viewport (IntersectionObserver),
  roughly 60–90 elements per mounted unit, so a few hundred SVG nodes at any time instead of ~6,000.
- No SVG filters, no blur, no masks. Gradients only in the fixed backdrop.
- Animated: Chikki (transform), fireflies and butterfly (transform/opacity, six or so small elements in the
  fixed layer), the current token's glow (box-shadow on one element). Nothing inside the scrolling SVGs
  animates.
- No scroll listeners; layout is measured once per width change (ResizeObserver).

## 7. Test plan

- Unit (vitest, `tests/unit/forest-map.test.ts`): metrics clamp and keep perches clear of trunks; unit
  layout heights and alternation; bridges start and end at the perches; flight arc endpoints, apex,
  duration bounds; decoration slots never fall on a perch; lesson-state rules match the classic path;
  current-perch and flight decisions.
- E2E (Playwright, `tests/e2e/forest-map.spec.ts`): forest is the default and Chikki is on lesson 1; after
  finishing lesson 1 Chikki ends on lesson 2; reduced motion; the Settings toggle switches to the classic
  path and back, and the choice survives a reload.
- The whole existing e2e suite must pass unchanged against the forest map.
- Screenshots (phone 390×844 @2x and desktop 1100 wide, light and dark; top of path, a section boundary
  mid-path, the Read & Write track), reviewed by eye and iterated.

## 8. What was built (differences from the plan above)

- Built as planned. Three rounds of screenshot review changed the art: the distant trees became layered
  foliage pads instead of round blobs, the moon/sun moved between the two distant tree layers, lantern and
  mushroom glows became soft gradients, the trunk tile got an organic outer edge (visible on wide screens),
  each section gate got leafy crowns that cap the two trunks, and the unit sign puts the Telugu title on the
  title line so descriptions wrap less.
- A bridge is drawn as built only when both of its ends are open, so there is never a finished bridge after
  a bare vine.
- Not done: `content-visibility` on off-screen units (risk to the text-based e2e checks), a hop animation
  when tapping an older perch, and any change to the page running top to bottom.

## 9. Decisions made without the owner

- The path still runs top to bottom (deeper into the forest) rather than bottom to top. Reversing the
  scroll direction of a 45,000 px page would have been a much riskier change for the same picture.
- The forest map remembers which track you were on while the app stays open, so after a Read & Write lesson
  you come back to the Read & Write path and see the flight. The classic path still resets to Speaking.
- On the Read & Write track the placement start section is ignored when deciding the current lesson (it only
  applies to Speaking). The classic path applies it to both, which leaves placed-ahead learners with no
  "current" lesson on Read & Write.
- Section titles use line icons instead of the emoji the classic banner uses.
- Tapping a different open perch does not make Chikki hop there first; it opens the lesson immediately.
