# Milestone celebrations

When a learner hits a milestone, a few seconds of a traditional dance from their
dialect plays over the screen. It is drawn as a cut-paper collage in the Ink
brand.

## When it plays

| Moment | Fired from | Tier |
|---|---|---|
| The first finish of a curriculum lesson | `Learn.tsx`, `handleProduceFinish`, when `savedProgress` (the state before this finish) is not completed | medium |
| An alphabet letter mastered | `AlphabetLetter.tsx`, when `completeStep` reports `mastered` | medium |
| Every review deck cleared, after reviewing something | `SessionHandoff`, given `reviewed` by the three review pages | medium |
| Badge earned | `useCheckAchievements` (it replaces the toast) | medium |
| Everything on today's list done, first time today | `Index.tsx`, via `claimDailyGoalCelebration` | large |
| A streak milestone (3, 7, 14, 30 … days), once per run | `useStreakMilestoneCelebration`, inside the host | large |

Pages call `celebrate({ kind, detail })` from `src/lib/celebrations.ts`;
`CelebrationHost`, mounted once in `App.tsx` ahead of the routes, renders it.
A moment that lands while the screen is up joins it as a line ("Badge earned!
First Steps") instead of queueing a second dance, and restarts its clock so
the line can be read.

The host picks the next dance in the learner's dialect's rotation and a cheer
in that dialect (`CHEERS`, checked by `detectMsaLeaks` in the tests). Every
cheer is an exclamation, not an address, so none has to guess the learner's
gender. A dialect with no dance drawn yet still gets the screen: the paper,
the circle, the cheer and the milestone, without dancers.

The trigger rules (the six moments, the once-a-day and once-per-run claims,
the folding of a burst into one screen) came from PR #403, whose watercolor
clips these collage scenes replace.

The dances so far: the Saudi **Ardah** (العرضة) and the Emirati and Omani
**Ayyala** (العيالة), both for Gulf learners.

## The Ardah (العرضة): drawn from reference keyframes and timed from the footage

The stills were redrawn from the twelve reference keyframes in
`docs/reference/ardah/` (PR #411; the README there describes each one). The
timing comes from `docs/reference/ardah/timing.md`, which was measured from the
clips and full videos (audio onsets, frame-timed drum strikes, the sway timed
by eye). Every state comes from a keyframe, and every timing number comes from
a measurement, except the one marked TODO below.

| State | Still | Keyframes (README entries) |
|---|---|---|
| Row at rest: sword at the chest, blade diagonal up the way the row faces, other hand just below it | `row-1.webp` | 5 (ardah1 4:16), 6 (ardah2 23:12) |
| Swords forward at waist height, arm extended, blades parallel and slightly down | `row-2.webp` | 7 (ardah1 6:12) |
| Sword arm straight up, blade tilted back, other hand open at chest-to-chin height | `row-3.webp` | 8 (ardah2 37:04) |
| Drummer, frame drum overhead, hooked stick against the face | `drummer-1.webp` | 9 (ardah1 2:48) |
| Drummer, drum at head height, stick held away | `drummer-2.webp` | 11 (ardah1 5:24) |
| Costume: white thobe, white shemagh and black agal, crossed black straps (one with cartridge loops), gold-embroidered belt, curved dagger hilt up at the centre front | all row stills | 5, 12 (also 4, 7) |
| Drummer costume: black mid-thigh jacket with heavy gold embroidery, red-and-white shemagh worn loose without an agal, mid-step in black shoes | drummer stills | 3, 9, 11 |
| Formation: men shoulder to shoulder in a row, drummers in the open space the row faces | the stage layout | 1, 2, 3, 4 |
| Sway: the whole row rocks side to side | CSS, no still | none (README: clip_ardah3 0:01–0:11; timing.md §2–3) |

**Timing, in `src/lib/celebrations.ts`, from `timing.md`.** The three
performances run at slightly different tempos. Following the timing notes, one
tempo is chosen and the rest is derived from it.

| Constant | Value | Source |
|---|---|---|
| `ARDAH_DRUM_STROKE_MS` | 1170 | The big-drum cycle in ardah2. Audio median 1172 ms (IQR 1167–1175); ten frame-timed stick strikes average 1190 ms. High confidence |
| `ARDAH_BEAT_MS` | = stroke (1170) | One pose per drum cycle. The one shot with repeated pose changes (ardah1 369.3–374.6 s) changes every 1.10–1.30 s, mean 1.20 s. Low confidence: a single shot |
| `ARDAH_DRUM_MS` | stroke ÷ 2 (585) | Each drummer strikes once per cycle and draws the stick back between strikes. The two stills each hold half a cycle |
| `ARDAH_SWAY_PERIOD_MS` | 2 × stroke (2340) | One sway is two drum cycles: ardah3 measures 2175–2225 ms (6 pulses) at its own tempo |
| `ARDAH_SWAY_DEG` | 3 | **TODO, not measured.** See below |
| `ARDAH.sequence` | rest, forward, rest, then overhead held for four beats | Rest and forward alternate one per cycle; overhead is held for whole shots (≥ 26.8 s) with a pump per cycle, which the jolt on each beat stands for |

**Three findings from the timing that the scene only approximates:**
- **The 45° sway is the swords, not the bodies.** The timing notes measure
  about 45° each way for blades swung overhead: an arm swing (ardah3
  441–452 s). The scene tilts the whole row, which stands for the gentler body
  rock seen at rest (ardah1 342–346 and 375–379 s). That rock's lean was never
  measured, so it stays a small 3°. Drawing the blade swing itself would need
  two more stills: overhead swung right and swung left.
- **Forward has a sub-motion.** The blades thrust out level, lift about 45°,
  come back level, then retract, all within the 1.2 s pose (ardah1 370–371 s
  and 372.4–373.6 s). The forward still shows the level thrust only.
- **The entry into overhead.** No shot shows the change into or out of
  overhead. Entering it from rest is an assumption, chosen so the 6 s scene
  reaches it (at 3.5 s) and the 3 s scene shows the rest/forward alternation.

**Assumptions made where the keyframes are silent:**
- **Feet in the sword rows** are never visible. The thobe reaches the floor
  over plain dark shoes, and the feet don't step.
- **The sword hand.** Keyframe 5 shows the right hand. In 7 and 8 it can't be
  read, so the right hand is used throughout.
- **The other hand.** In the forward pose it hangs at the side by the belt,
  because keyframe 7 doesn't show it.
- **Robes.** All three row stills use the white-thobe costume from keyframes
  5 and 12. The rows in keyframes 6 and 8, where two of the poses come from,
  wear green robes.
- **Facing.** The row faces frame-left in every state, so the pose swap
  doesn't flip it. In keyframe 8 the faces turn up and frame-right; here they
  turn up toward the raised swords.
- **Size of the row.** Three men stand in for rows of 9–20, and only one row
  is shown. The facing row and the green flag (keyframes 1 and 5) are left
  out: the flag carries text that would have to be drawn exactly.
- **Drums.** Only the frame drum is drawn. The large drums held at waist
  height (keyframes 4 and 10) are not.
- **The sway** is a rigid tilt of the whole row, because no still shows how
  the bodies move in it (see the findings above).
- **The style.** Snapping between poses, and the small tilt and shift on each
  swap, are the collage style, not motion taken from the footage.
- **The performers** are generated people. Their poses were described to the
  image model in words, from the keyframes. The real frames were never
  uploaded, so no real performer's likeness is in the art.

**Before this ships to learners:** a Saudi reviewer's sign-off. Measuring the
body rock's lean (`ARDAH_SWAY_DEG`) would close the last TODO.

## The Ayyala (العيالة): drawn from reference keyframes and timed from the footage

The second Gulf dance. Gulf learners' celebrations rotate between it and the
Ardah. Its reference pack is `docs/reference/ayyala/` (PR #414: ten keyframes
and a Timing section, measured from four videos).

| State | Still | Keyframes (README entries) |
|---|---|---|
| Cane up: forearm raised, the cane near vertical above the hand | `row-1.webp` | 6 (ayyala1 4:25); the "cane up" of Timing §4c, whose frames are not keyframes |
| Arm out: arm forward and down, the cane running on to the floor ahead | `row-2.webp` | 5 (ayyala3 0:37) |
| Canes forward: arm out at chest height, forearm level, the cane rising at about 45° | `row-3.webp` | 4 (ayyala2 11:40) |
| Bow: bent forward at the hips, the hooked cane upright, crook in the hand at belt height | `row-4.webp` | 7 (ayyala1 4:32) |
| Drummer: a large round frame drum held up at head height, a hand under its rim | `drummer-1.webp` | 9 (ayyala3 1:21) |
| Costume: white kandura, white ghutra with a black agal ring | all stills | 1, 6, 7, 8 |
| Formation: men shoulder to shoulder in a row, drummers in the open floor the row faces | the stage layout | 1, 2 |

**Timing, in `src/lib/dances.ts`, from the README's Timing section.** Both
cycles the footage measures are six strokes long, so one step is one stroke
and each pose is repeated for as many strokes as it is held.

| Constant | Value | Source |
|---|---|---|
| `AYYALA_STROKE_MS` | 343 | ayyala3 0:30–1:00, median 343 ms (IQR 332–354), the stretch where the cane cycle was hand counted. Medium confidence |
| `AYYALA_CANE_UP_STROKES` / `AYYALA_ARM_OUT_STROKES` | 2 / 4 (686 / 1372 ms) | Cane up about 0.5 s (0.3–0.7), arm out about 1.4 s (1.1–1.6), a cycle every 2.0 s ±0.1, about six strokes (ayyala3 0:30.0–0:39.7). Medium-low |
| `AYYALA_FORWARD_STROKES` / `AYYALA_BOW_STROKES` | 3 / 3 | ayyala2's row cycle: canes splayed forward, then 1.2 s later held in, every 2.42 s, about six strokes at that troupe's tempo. Medium-low |
| `AYYALA_SWAY_DEG` | 0 | No sway was separated from the bow in any footage, so none is drawn |
| `AYYALA.sequence` | two cane cycles, then two forward-and-bow cycles | 6 s reaches the bow at 5.1 s; 3 s is the cane cycle alone |

**What the scene only approximates:**
- **The bow's depth.** The bowed head drops about 27% of the standing height
  in the still, against 30–33% measured (ayyala1, keyframes 7–8 against 6,
  itself a lower bound). Two shallower generations were discarded.
- **The change between the two cycles.** The cane cycle (ayyala3) and the
  forward-and-bow cycle (ayyala2) are different troupes, and no shot shows a
  row go from one to the other.
- **The drummer doesn't strike.** Who strikes which drum, and how, can't be
  read in any frame (README, "Not covered"), so the drummer is one still.
  The cymbals (keyframe 10) are left out: where their player stands is not
  shown.

**Assumptions made where the keyframes are silent:**
- **The costume** is the Emirati one (keyframes 1, 6–8). The Omani troupes in
  keyframes 3–5 and 9 wear turbans and grey-blue robes, and two of the poses
  come from them.
- **The cane hand** can't be read in most frames; the right hand is used
  throughout, holding the cane by its crook as in keyframe 7.
- **Facing.** The row faces frame-left, toward the drummer, in every state,
  and bows that way. In keyframe 7 the men bow toward the camera.
- **Size.** Three men stand in for rows of a dozen or more; the facing row is
  left out, as in the Ardah.
- **The performers** are generated people, posed from written descriptions of
  the keyframes. No real frame was uploaded.

**Before this ships to learners:** an Emirati or Omani reviewer's sign-off.

## The look

The owner picked this direction from two style rounds. Its references are
Telfaz11's *Folklore 101* series and Vox's explainers. Its elements:

- **Dancers:** grayscale photo cutouts with a rough paper edge.
- **Ground:** flat mustard paper with faint Arabic print showing through.
- **Title:** the dance's name in Rakkas, inside a frame drawn from the dialect's
  own architecture. The Ardah uses a Najdi parapet and door triangles. The
  planned frames are a mashrabiya for Egyptian and a qamariya window for
  Yemeni.
- **Vox touches:** an oxblood circle behind the dancer, a grid-paper scrap,
  paper tape, and ink label boxes for the cheer and the milestone.

Only the dancers are pictures. The paper, frame, title, labels and tape are
drawn in code, so they follow the brand and can carry live text.

## How the dancers move: pose swap

A dance is a handful of stills of one row of performers. The scene snaps from
one still to the next on the beat, and the row sways as one. Each swap lands with a small jolt, a slight tilt and a
small sideways shift, so every frame looks hand-placed.

This was chosen over cut-out video footage and hinged photo puppets for these
reasons:

- It matches the reference rhythm.
- Every frame is a still a native reviewer can approve.
- The full Ardah set is about 200 KB.

The other two methods, and a test of each, are on the "Hikaya Collage Dances"
board linked from the PR that introduced this.

| Tier   | Length | Used for                                  | Contents            |
|--------|--------|-------------------------------------------|---------------------|
| small  | 1.5 s  | nothing yet (`?celebrate=<dance>-small`)  | dancers             |
| medium | 3 s    | lesson, letter, deck, badge               | dancers + musician  |
| large  | 6 s    | daily goal, streak milestone              | dancers + musician  |

The celebration closes itself when its tier ends. Continue, Escape, or a tap
outside the stage ends it sooner. Under reduced motion it holds the first pose
and doesn't sway.

## Where the code is

| Piece | Purpose |
|---|---|
| `src/lib/dances.ts` | The catalogue (`ARDAH`, `DANCES`, `dancesFor`), each dance's measured timing constants, and `poseAt` (what is on stage at a given moment; pure and tested). |
| `src/lib/celebrations.ts` | When and how long: the moment kinds, tiers, the rotation, the cheers, the copy, the daily-goal and streak claims, the preview parameter, and the `celebrate()` bus. |
| `src/components/celebrations/CelebrationHost.tsx` | Mounted in `App.tsx`. Listens on the bus, picks the dance and cheer, folds a burst into one screen, plays `?celebrate=`. |
| `src/components/celebrations/CelebrationOverlay.tsx` | The full-screen dialog and the auto-dismiss. |
| `src/components/celebrations/CelebrationScene.tsx` | The collage stage. |
| `src/components/celebrations/danceArt.ts` | Maps each dance to its stills, and where they stand. |
| `src/assets/celebrations/<dance>/` | The stills. |
| `src/hooks/useStreakMilestoneCelebration.ts` | Watches the streak row for a milestone. |

**Preview without finishing a lesson:** add `?celebrate=ardah` to any address.
You can also choose the tier with `?celebrate=ardah-small` or
`?celebrate=ardah-large`. The parameter is removed from the address once read,
so a reload doesn't replay it.

## Making a new dance

1. **Choose the poses from reference footage, not from memory.** Pick the key
   poses from real performances, with timestamps, including one "home" pose
   to return to between moves, and write down only what each frame shows.
   `docs/reference/ardah/README.md` is the model. Add a musician in two
   positions if the dance has one. Time the beat against the footage's
   drums.
2. **Generate the photos** on Higgsfield with `gpt_image_2_5` at high quality,
   portrait 2:3, at 1.5 credits each.
   - Generate the first pose alone.
   - Pass its job id as an `image_references` input for every other pose of
     the same performer, which keeps the same face and costume.
   - Describe the costume and each pose precisely, in words, from the
     reference notes. Don't upload real frames as references: the generated
     people must not borrow a real performer's face.
   - Ask for the whole body in frame with empty space around it, on a plain
     flat **mid-grey** seamless backdrop with no floor shadow. A white thobe
     on a pale backdrop defeats the background removal.
3. **Cut them out:**

   ```sh
   pip install "rembg[cpu]" pillow numpy scipy
   python scripts/celebrations/make_cutouts.py dancer src/assets/celebrations/<dance> pose1.png …
   python scripts/celebrations/make_cutouts.py drummer src/assets/celebrations/<dance> drum1.png drum2.png
   ```

   Check that the performers are the same size and stand in the same place
   in every still. Generation sometimes frames one pose differently: the
   Ardah's raised-sword still came out with smaller men, because the model
   made room for the swords. That still was split into its three men, and
   each was scaled about his own feet to the rest pose's size and position
   before the sticker finish.

   The script also drops large patches of the backdrop's own grey that the
   models keep because they are boxed in (between a cane and a robe, or
   between two men), and calms the torn edge along anything thin, which
   otherwise turns a cane into a string of beads. Both were added for the
   Ayyala; the Ardah's stills were cut before them.
4. **Add the dance** to `DANCES` in `src/lib/dances.ts` (title, gloss,
   region, beat, sequence, each timing number a named constant with its
   source) and its stills to `danceArt.ts`, with a `dancersBox` when the
   figures are framed differently from the Ardah's row. Its id must not
   contain a dash, which `?celebrate=` reads as the tier. If the dance
   belongs to another dialect, draw that dialect's frame.
5. **Review.** A native speaker of the dialect checks the costume, the props
   and the cheers before the dance ships.

## Open decisions

- **Ta'sheer:** the dance in the Telfaz11 reference is danced with rifles. The
  Ardah, with swords, was chosen for Saudi.
- **Women's dances:** for example the Gulf hair dance or the Saidi cane dance.
  Not decided. If included, they should be drawn or silhouetted inside the
  same collage rather than photographic.
- **Sound:** drum loops per dance could be generated on Higgsfield. The
  celebration is silent for now.
- **Other milestones:** stage completion and weekly goals have no "crossing
  moment" on the client yet.
