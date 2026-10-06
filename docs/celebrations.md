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
gender. Every dialect now has at least one dance. A dialect without one would
still get the screen: the paper, the circle, the cheer and the milestone,
without dancers.

The trigger rules (the six moments, the once-a-day and once-per-run claims,
the folding of a burst into one screen) came from PR #403, whose watercolor
clips these collage scenes replace.

The dances so far: the Saudi **Ardah** (العرضة), the Emirati and Omani
**Ayyala** (العيالة), the Hejazi **Mizmar** (المزمار), the Bahraini
**Khammari** (الخماري) and the Omani **Razha** (الرزحة) for Gulf learners;
the **Saidi cane dance** (رقص العصاية), the **Tanoura** (التنورة) and the
**Tahtib** (التحطيب) for Egyptian learners; and **Al-Bara'** (البرع) and the
**Sana'ani dance** (الرقص الصنعاني) for Yemeni learners. Within a dialect the
rotation alternates kinds of dance, so the Gulf goes Ardah, Ayyala, Mizmar,
Khammari, Razha.

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

## The Saidi cane dance (رقص العصاية): drawn from reference keyframes and timed from the footage

The first Egyptian dance. Its reference pack is `docs/reference/assaya/`
(PR #414). Everything the pack measures is one solo man in a troupe's stage
show (assaya3), so the scene is that solo. The women in the footage carry
and raise canes in the groups but are never seen twirling, tossing or
balancing one, and the men's group (assaya6) was not measured.

| State | Still | Keyframes (README entries) |
|---|---|---|
| Mid-spin on one foot, the other leg kicked back, the cane across the chest in both hands | `dancer-1.webp` | 6 (assaya3 0:34) |
| Walking, the cane across the back of the shoulders, one forearm hooked over it | `dancer-2.webp` | 9 (assaya3 1:46) |
| Low lunge, the cane held up and out in one hand, the other arm out | `dancer-3.webp` | 8 (assaya3 1:01) |
| Standing, the cane upright over the hand, head tilted up | `dancer-4.webp` | 7 (assaya3 0:40) |
| Costume: long dark galabeya with a cream lining, white turban with a tail, white shoes | all stills | 6, 7, 9 |

**Timing, in `src/lib/dances.ts`.** The README finds no beat in his poses:
they change every 100–900 ms, median 200–400, with no regular order. So the
steps are the music's main stroke, and each pose is held for the strokes
nearest its measured length.

| Constant | Value | Source |
|---|---|---|
| `ASSAYA_STROKE_MS` | 250 | The music's main interval: median 249.6 ms in three stretches of assaya3, on a 126 ms grid, accent about every 505 ms. Medium confidence, audio only |
| `ASSAYA_SPIN_STROKES` / `ASSAYA_SHOULDERS_STROKES` | 3 / 2 (a turn every 1.25 s) | While he spins, the cane-across-the-chest pose comes back every 1.17 s (SD 0.19), the shoulders or the cane held out between. Low confidence (10 fps labels) |
| `ASSAYA_UPRIGHT_STROKES` / `ASSAYA_HELD_OUT_STROKES` | 2 / 1 | Upright holds of 320–800 ms, mean 520 (4 holds), between tosses of about 220 ms; the cane held out in the same place in the kneeling passage |
| `ASSAYA.sequence` | two turns, then two upright holds | No regular order exists; these are the two runs that repeat (README 4c) |

**What the scene leaves out or approximates:**
- **The twirl** (2.59 turns a second) and **the toss** (about 220 ms in the
  air) are the dance's showpieces, but no keyframe shows either: at 1 frame
  a second they are blurs. The cane held out stands in for the toss between
  upright holds.
- **The lunge** comes from the kneeling passage. Between it and the
  standing upright hold, the scene jumps from kneeling to standing in one
  stroke.
- **No musician.** The band is never in view in assaya3, so unlike the
  Gulf scenes this stage has no drummer, and more open floor.
- **The frame** is the Egyptian one: a Cairo mashrabiya's lattice under
  Mamluk stepped crenellations.

**Assumptions:** the cane is plain and straight (the README: "long, thin,
straight", its ends often hidden); his facing is turned frame-left in every
state; the performer is generated from written descriptions, never from the
frames.

**Before this ships to learners:** an Egyptian (ideally Sa'idi) reviewer's
sign-off.

## The Tanoura (التنورة): drawn from reference keyframes and timed from the footage

The second Egyptian dance; Egyptian learners' celebrations rotate between it
and the Saidi cane dance. Its reference pack is `docs/reference/tanoura/`
(PR #414), three performances by Cairo's Heritage Tanoura troupe. The scene is
the dancer the pack measures best, the yellow-top dancer of tanoura6.

| State | Still | Keyframes (README entries) |
|---|---|---|
| Front, the skirt a flat disc at the hips, arms out | `dancer-1.webp` | 4 (tanoura6 3:04), 3 |
| Profile, facing frame-right | `dancer-2.webp` | the turn as Timing §4b reads it: front, profile, back, profile |
| Back | `dancer-3.webp` | as above |
| Profile, facing frame-left | `dancer-4.webp` | as above |
| Front, arms straight up, the upper layer held overhead as a disc | `dancer-5.webp` | 4 |
| Back, the same | `dancer-6.webp` | 4, and the turn |
| Musician: a frame drum held against the chest | `drummer-1.webp` | 10 (tanoura3 0:33) |
| Costume: yellow shirt and trousers, an embroidered vest with a red front panel, a white head-cloth with a flying tail; the hip disc black with green, orange and white, the raised one red beneath | all dancer stills | 4 |

**Timing, in `src/lib/dances.ts`.** The movement is the spin, so the pose
swap is the spin: one still a quarter turn.

| Constant | Value | Source |
|---|---|---|
| `TANOURA_TURN_MS` | 990 | The yellow-top dancer, 0.994 s a turn over 19 hand-counted turns (tanoura6 4:00–4:19, SD 0.07 s). Other dancers and moments: 0.81–1.46 s. Medium confidence |
| `TANOURA_QUARTER_MS` | turn ÷ 4 (247.5) | One view per quarter turn, in his order (counter-clockwise seen from above) |
| `TANOURA_HIP_TURNS` / `TANOURA_OVERHEAD_TURNS` | 2 / 2 | The lift: about 290 ms from the hip to overhead (one quarter-turn step), then held about 7.1 s (tanoura6) or 8.6 s (tanoura1). Two turns stand in for the hold |

**What the scene only approximates:**
- **Overhead, he is drawn front and back only.** Each view is held half a
  turn, so the spin reads coarser while the disc is up.
- **The hold is cut** from about 7 s to two turns, and the scene loops back
  to the hip spin rather than lowering the layer through "head height" and
  "dropping" (README 4c), which would need three more stills.
- **The discs don't turn.** Their wedge pattern is a smear in the footage;
  the stills show it sharp.
- **The musician doesn't strike**: no stroke can be matched to the sound
  (README 4a).

**Assumptions:** the profile and back views are not keyframes; the README
names them as what the turn count reads, and the costume's back is drawn
from its front. The performer is generated from written descriptions.

**Before this ships to learners:** an Egyptian reviewer's sign-off.

## The Tahtib (التحطيب): drawn from reference keyframes and timed from the footage

The third Egyptian dance. Its reference pack is `docs/reference/tahtib/`
(PR #414). The fencing was labelled pose by pose over 40 s of one pair in one
continuous shot (tahtib2, the Luxor festival); the drum was measured on the
same festival stage (tahtib3).

| State | Still | Keyframes (README entries) |
|---|---|---|
| Apart, about two stick lengths between them, sticks raised toward each other at about 50° in an open V | `pair-1.webp` | 3 (tahtib2 5:10) |
| Crossed: chest to chest, both sticks held level above the heads, hands gripping | `pair-2.webp` | 4 (tahtib2 5:36) |
| The swing: one stick held level at head height, the other raised high over the head | `pair-3.webp` | 6 (tahtib2 5:42), 5 |
| Drummer: a large frame drum at belly height, struck with the open hand; the hand on the skin, then lifted | `drummer-1.webp`, `drummer-2.webp` | 8 (tahtib3 7:24) |
| Costume: one in a brown galabeya and white cap, one in a black galabeya and white turban, the drummer in grey | all stills | 3, 8 |

**Timing, in `src/lib/dances.ts`.** The pack finds no beat in the fencing
and no fixed order, but it does measure how often the poses change, how
often the sticks meet, and which change follows which.

| Constant | Value | Source |
|---|---|---|
| `TAHTIB_GRID_MS` | 134 | The drum's onsets lock to a 133–135 ms grid in three stretches of tahtib3 (R 0.33–0.50). Medium confidence |
| `TAHTIB_FIGURE_STEPS` | 1-1-2 (536 ms) | The drum's short-short-long figure, in runs of up to 11.7 cycles (tahtib3 3:12–3:18). The drummer's stills follow it on half grid steps: a strike at 0, 134 and 268 ms of every 536 |
| `TAHTIB_STEP_MS` | 2 × grid (268) | The poses change every 303–484 ms on average (108 hand-labelled segments) |
| `TAHTIB_CROSSED_STEPS` | 2 (536 ms) | Crossed segments last 545 ms on average |
| `TAHTIB.sequence` | apart, crossed, crossed, the swing, repeated | The commonest transitions: apart to crossed, crossed to the swing, the swing to apart (12, 12 and 13 of 65). One round is 1.07 s; the sticks meet every 0.8–1.2 s (median) |

**What the scene only approximates:**
- **The order repeats.** The footage has no repeating block; the scene
  repeats its commonest round.
- **The swing** is a blur in the footage (keyframes 5 and 6); the still
  holds the stick raised instead.
- **The pair passes and circles.** They swap sides by walking past each
  other every 2–5 s, and step about; the scene keeps them on their sides.
- **The drummer is from another video** of the same festival stage (the
  duel's drummers are off-screen), and the stick strokes are not shown to
  follow the drum (README 4b), so the two clocks run independently, as they
  seem to in the footage.

**Assumptions:** no blow lands on a body, as in the 45 s checked frame by
frame; the sticks are plain, pale and straight. The performers are generated
from written descriptions. The drummer's grey galabeya is the backdrop's own
grey, so he was cut with `make_cutouts.py --keep-grey`.

**Before this ships to learners:** a Sa'idi reviewer's sign-off.

## Al-Bara' (البرع): drawn from reference keyframes and timed from the footage

The Yemeni dance. Its reference pack is `docs/reference/baraa/` (PR #414). No
official or festival recording of a large Bara' was found; the pack works
from a staged TV item (baraa1, too blurred for poses), a street Bara' with a
drummer (baraa2, where the poses and the step were measured) and a studio
drum demonstration (baraa5). The scene is the street Bara'.

| State | Still | Keyframes (README entries) |
|---|---|---|
| Upright, bent a little forward, the drawn jambiya in a fist at waist-to-chest height, blade level | `row-1.webp` | 3 (baraa2 2:00) |
| Upright, the blade up beside the head, tip up, the fist at the forehead | `row-2.webp` | 4 (baraa2 0:31) |
| Folded forward, the blade held level at the brow | `row-3.webp` | 4 (the frame-left dancer) |
| Knees deeply bent, feet wide, the dagger low at the side | `row-4.webp` | 5 (baraa2 4:08) |
| Drummer: a big round drum on a strap at the hip, a thin stick in each hand | `drummer-1.webp` | 3 |
| Costume: bareheaded, dark suit jackets over a white thobe or a tan futa with a purple hem, a broad belt with an embroidered jambiya sheath at the front, barefoot | all row stills | 3, 4, 5 |

**Timing, in `src/lib/dances.ts`, from the README's Timing section.** The
movement measured best in the whole pack is the dancers' bob: down and up
together once per step. The scene draws it as a drop of the whole row
(`bobPct`) and changes still on the half bob.

| Constant | Value | Source |
|---|---|---|
| `BARAA_BOB_MS` | 430 | One down-and-up: 419–440 ms across optical flow in three stretches of baraa2 (0:26–2:14) and a hand count of 7 cycles in 3.04 s (434 ms). High confidence for that stretch |
| `BARAA_PULSE_MS` | 143 | The audio pulse in the same stretches, 140–146 ms, three to a bob. Never seen as a strike, so it times nothing on its own |
| `BARAA_STEP_MS` | bob ÷ 2 (215) | A still holds half a bob: folded at the bottom, taller at the top (frames at the bob's low point show them folded forward) |
| `BARAA_BOB_PCT` | 4.5 | The head top moves about 5% of body height (2–7%, four frames on a grid); the bodies fill about 90% of the row's box |
| `BARAA_HEAD_BOBS` / `LOW` / `WAIST` | 3 / 1 / 6 | The poses come in this order in baraa2 0:26–0:46, held 6.4, 1.2 and 12.4 s: the same order and proportions in a ten-bob loop |

**What the scene only approximates:**
- **The section lengths** are scaled down about five times to fit a 3–6 s
  scene; only their order and proportions are kept.
- **The folded still alternating with the upright one** in the blade-at-the-
  head section is a reading of the README (the frame-left dancer goes between
  them at 0:26–0:29, folded at the bob's low point), not a count.
- **The bob** is a rigid drop of the whole row, feet included; in the footage
  the feet stay down and the knees bend.
- **The drummer doesn't strike.** No stick is ever seen touching a skin.
- **The tempo stages** of the staged item (the pulse quickening 1.19 then
  1.13 times) are longer than any scene and not drawn.

**Assumptions:** the dagger hand is the right one throughout; the row faces
frame-left, toward the drummer; three dancers stand in for the line. The
folded still was refused twice by the image model's safety filter when asked
for a blade at the face, and the third attempt kept the hilts in the
sheaths, so they were painted out locally (a drawn jambiya leaves its sheath
empty). The performers are generated from written descriptions; the street
footage's people were never uploaded.

**Costume, decided:** the street dress of the footage stays: suit jackets
over a thobe or futa, bare heads, bare feet (the owner's call, 2026-10-06),
rather than a festival costume.

**Before this ships to learners:** a Yemeni reviewer's sign-off.

## Al-Mizmar (المزمار): drawn from reference keyframes and timed from the footage

A Gulf dance, from the Hejaz. Its reference pack is `docs/reference/mizmar/`
(PR #414): the UNESCO inscription film (mizmar1), a community night in a yard
(mizmar8) and a documentary that re-stages the dance with a costumed troupe
in a courtyard (mizmar10), where the clap was timed and the poses labelled.
The scene is one dancer between the rows, with a clapper from the rows.

| State | Still | Keyframes (README entries) |
|---|---|---|
| Stride, the hand at head height, the cane running down to the floor ahead | `dancer-1.webp` | 10 (mizmar1 3:12) |
| Stride, the cane held vertical above the head, the other hand low | `dancer-2.webp` | 7 (mizmar10 7:56) |
| Mid-step, one foot lifted behind, the cane level above the head, half way round a twirl | `dancer-3.webp` | 4 (mizmar8 3:16) |
| Clapper: hands apart at the chest, a cane leaning against his shoulder | `clapper-1.webp` | 6 (mizmar10 4:39) |
| Clapper: palms meeting, one hand sliding over the other | `clapper-2.webp` | 6, and the 9-of-10 clap check in Timing 4b |
| Costume: mizmar10's troupe, a green vest over a white thobe, a dark green belt, a green-and-white patterned turban, black shoes | all | 6, 7 |

**Timing, in `src/lib/dances.ts`, from the README's Timing section.**

| Constant | Value | Source |
|---|---|---|
| `MIZMAR_CLAP_MS` | 1317 | The rows' slow clap, mizmar10 4:38–5:32: 22 intervals, SD 18.5 ms; the palms meet on 9 of 10 onsets within a frame. Medium confidence |
| `MIZMAR_PULSE_MS` | clap ÷ 8 (165) | The labelled take's own pulse is 166–168 ms; an eighth of the clap is within 2% of it and keeps the dancer and the clapper on one clock |
| `MIZMAR_STRIDE_PULSES` | 4 | The stride's mean labelled segment, 693 ms (42 segments) |
| `MIZMAR_OVERHEAD_PULSES` | 3 | The stick-overhead mean, 433 ms (42 segments) |
| `MIZMAR_TWIRL_PULSES` | 4 | One revolution of the stick, 630 ms (mizmar8, the one clean count) |
| `MIZMAR_CLAP_CONTACT_PULSES` | 1 | The palms touch for about three frames at 24 fps (125 ms) |

**What the scene only approximates:**
- **The order.** The footage has none: stride, overhead and sticks meeting
  follow each other irregularly, stride the commonest and the longest. The
  scene puts a stride between every other pose and keeps stride over half
  the time (the footage: 29 of the 47 s with one of the two).
- **The twirl** is one still, the stick level overhead, held for the length
  of one revolution. A turning stick is a blur no still can show.
- **The cane's slope in keyframe 10** measures 38° below horizontal in the
  picture, from a raised camera behind the dancer. In profile, a cane 0.9 of
  his height held at head height cannot reach the floor at 38°, so the still
  keeps what the README says of the pose (hand at head height, cane down to
  the floor ahead) and the slope comes out steeper.
- **Sticks meeting** takes two dancers, and the scene has one, so it is left
  out.

**Assumptions:** one costume for all three poses (keyframe 10 is the UNESCO
film's white thobe and skullcap, keyframe 4 a barefoot man in grey); the
dancer faces frame-left, toward the clapper; the overhead still was generated
smaller than the others and scaled 1.30 about his feet, the twirl still 1.04.

**Before this ships to learners:** a Hejazi reviewer's sign-off.

## Al-Razha (الرزحة): drawn from reference keyframes and timed from the footage

A Gulf dance, from Oman. Its reference pack is `docs/reference/razha/` (PR
#414). Everything drawn comes from razha12, a wedding Razha in Ja'alan Bani
Bu Hassan filmed openly by one community videographer. Nothing is drawn from
razha1, the British Library and Qatar Digital Library film, which asks users
to follow its ethical-use policy (the pack's keyframe 10). The scene is three
men at the near end of the row, and a drummer.

| State | Still | Keyframes (README entries) |
|---|---|---|
| Canes upright, hooks up, held at chest-to-belt height | `row-1.webp` | 2 (razha12 6:40) |
| Canes raised diagonally across the body at about 45°, hooks up and forward, crossing the neighbours' | `row-2.webp` | 3 (razha12 6:25) |
| Canes held low, the hand at the belt, slanting down and forward | `row-3.webp` | Timing 4c, razha12 6:27–6:31 (no keyframe) |
| Drummer: a rope-laced barrel drum on a sling at the hip, a thin stick raised to shoulder height, the other hand on the rim | `drummer-1.webp` | 6 (razha12 2:53) |
| Costume: white and cream dishdashas, Omani turbans, a silver belt with a khanjar at the front, sandals; hooked canes | all row stills | 2, 3 |

**Timing, in `src/lib/dances.ts`, from the README's Timing section.** The
canes change state every 3–14 s, on neither the stroke nor the accent; the
scene steps on the accent so each state's length is a whole number of them.

| Constant | Value | Source |
|---|---|---|
| `RAZHA_ACCENT_MS` | 775 | Every fourth stroke of about 197 ms (razha12, core medians 192–197 ms in five stretches; accent lags 766–778 ms). Medium confidence; no strike matched in the picture |
| `RAZHA_UPRIGHT_ACCENTS` | 4 | Upright 3.1 s (razha12 6:20.0) |
| `RAZHA_CROSSING_ACCENTS` | 5 | Raised and crossing 3.9 s (6:23.1) |
| `RAZHA_LOW_ACCENTS` | 5 | Held low 4.0 s (6:27.0) |
| `RAZHA_LONG_UPRIGHT_ACCENTS` | 16 | Upright again 12.4 s (6:33.2) |

**What the scene only approximates:**
- **It opens part-way through the first stand**, on its last two accents,
  so the three-second scene reaches the crossing (1.55 s) and the six the
  low hold (5.4 s).
- **The canes move together.** In the footage each man is out of step with
  the next, and the changes are timed for the men nearest the camera.
- **"Raised forward and up"** (14.4 s, from 6:45.6) comes after the longest
  scene ends, so it is not drawn; nor is the mixed stretch at 6:31.
- **The drummer doesn't strike.** Several drums sound at once and no stroke
  in the picture lands on a skin.

**Assumptions:** the row faces frame-left, toward the drummer; three men
stand in for the row; no rifle is drawn (keyframe 3 has one in the middle of
the row). The upright canes are brown against the backdrop grey, which
neither cutout model keeps, so `make_cutouts.py --key-colour` keys them back
in.

**Before this ships to learners:** an Omani reviewer's sign-off.

## The Khammari (الخماري): drawn from reference keyframes and timed from the footage

A Gulf dance, and the first women's dance in the set. Its reference pack is
`docs/reference/gulf-women/` (PR #414), and the scene uses only its video 1:
a Bahrain TV recording whose own caption names the dance ("فن .. خماري"), on a
courtyard set, where the women bow and lean while the men drum. Nothing is
drawn from videos 2 and 6, which the pack flags (a bare-headed singer, young
performers, a women-only room). The rules for the women, from the pack and
from #403: television footage only, hair covered, described by costume,
formation and movement only.

| State | Still | Keyframes (README entries) |
|---|---|---|
| Upright, hands together at the waist | `row-1.webp` | 1 (gulf-women1 0:12) |
| Lean: head and shoulders dipped, the torso inclined less than a bow | `row-2.webp` | Timing 4c (no keyframe) |
| Bow: bent forward from the waist, about 18°, head down, the head cloth falling forward | `row-3.webp` | 3 (gulf-women1 7:57) |
| Drummer: a man in a white thobe and ghutra holding a frame drum at the chest | `drummer-1.webp` | 4 (gulf-women1 1:30) |
| Costume: long printed floral gowns (a red one with a green panel, as the measured woman wears), each with a cloth drawn over the head and down the back | all row stills | 1, 3 |

**Timing, in `src/lib/dances.ts`, from the README's Timing section.** The
right-end woman of video 1 was labelled change by change at 10 fps
(7:54.0–8:17.9); the scene plays her first block on the music's grid.

| Constant | Value | Source |
|---|---|---|
| `KHAMMARI_GRID_MS` | 234 | The onset grid, two steps to the 464 ms beat (video 1 7:48–8:40). Medium confidence; audio only |
| `KHAMMARI_STEPS` | 4 · 1 · 7 · 2 · 7 · 4 · 8 | Upright (its last 0.9 s), lean 0.3 s, bow 1.6 s, lean 0.5 s, upright 1.7 s, lean 1.0 s, upright 2.8 s (8 + the opening 4 across the loop): 7:55.0–8:03.8. The loop is 7.7 s; her bows come 7.9 and 7.6 s apart |

**What the scene only approximates:**
- **The lean has no keyframe**; its still follows the README's definition.
- **The women move together.** Only the right-end woman was timed.
- **The drummer doesn't strike.** No strike was matched to the sound.
- **The calligraphy on the drum** (red lettering in keyframes 2 and 4) is
  left off: the image model misspelled it, and the lettering can't be read
  in the footage anyway.
- **The men lead the dance in the footage** (the pack's flag 5): a line of
  about fifteen drummers, one woman among them. The scene keeps the women's
  bow and one drummer.

**Assumptions:** three women stand in for the two groups; they face
frame-left, toward the drummer (the model drew them facing right, so the
stills are mirrored, which changes nothing in a printed gown).

**Before this ships to learners:** a Bahraini reviewer's sign-off, and the
owner's on drawing women as photographic cutouts (see Open decisions).

## The Sana'ani dance (الرقص الصنعاني): drawn from reference keyframes and timed from the footage

The second Yemeni dance. Its reference pack is `docs/reference/sanaani/`
(PR #414): the heritage film (sanaani17, the one video that names the dance
on screen), a satellite-TV programme and a studio's video of a men's wedding
in Sana'a (sanaani62). The dancers are sanaani17's; the singer is
sanaani62's.

| State | Still | Keyframes (README entries) |
|---|---|---|
| The chain: hands joined, arms out at shoulder height, facing the camera | `row-1.webp` | 1 (sanaani17 5:00) |
| The release: hands free, walking across the floor, seen from behind | `row-2.webp` | 3 (sanaani17 5:11) |
| Singer: a young man seated, singing with his eyes half closed, an oud across his lap, in a grey jacket with an embroidered mustard shawl and a flower garland | `singer-1.webp` | 8 (sanaani62 0:50) |
| Costume: a dark blazer over a white shirt, a white ankle-length skirt, a gold belt with a jambiya, a cream-and-gold head cloth with tails, black socks and shoes | both row stills | 1, 3 |

**Timing, in `src/lib/dances.ts`, from the README's Timing section.** The
movement measured best is the bob, about twice a second in all three videos;
sanaani17's is the scene's clock, since its stills are sanaani17's.

| Constant | Value | Source |
|---|---|---|
| `SANAANI_BOB_MS` | 535 | sanaani17: optical flow and a head tracker within 1% (535.0 / 532.5 ms); 484–547 across shots. Not tied to that film's track |
| `SANAANI_BOB_PCT` | 3.5 | 2–6% of standing height peak to peak (sanaani17 only; low confidence); the bodies fill about 90% of the box |
| `SANAANI_RELEASE_BOBS` | 3 | The release walk, 1.4–1.6 s (five times in sanaani17 4:57–5:51) |
| `SANAANI_CHAIN_BOBS` | 22 | The chain, about 11 s, and the regrouping, 0.4–1.2 s: a cycle of 13.4 s against the measured 13.2 |
| `SANAANI_OPENING_BOBS` | 3 | Bobs of chain before the first release, so the three-second scene shows it |

**What the scene only approximates:**
- **The regrouping** (the men turning back to face the camera, hands still
  free) has no keyframe, so the chain comes straight back after the walk.
- **The bob** is a rigid drop of the whole row, as in Al-Bara'.
- **The singer doesn't play.** No oud stroke could be matched to the sound,
  and he comes from a different video from the dancers. His microphone on
  its stand is left out; the tray player beside him is not drawn.

**Assumptions:** three men stand in for keyframe 1's line of six (keyframe
3 shows four walking); they walk toward frame-right in the release, away from
the singer; the release still was generated smaller and scaled 1.13 about
their feet.

**Before this ships to learners:** a Yemeni reviewer's sign-off.

## The look

The owner picked this direction from two style rounds. Its references are
Telfaz11's *Folklore 101* series and Vox's explainers. Its elements:

- **Dancers:** grayscale photo cutouts with a rough paper edge.
- **Ground:** flat mustard paper with faint Arabic print showing through.
- **Title:** the dance's name in Rakkas, inside a frame drawn from the dialect's
  own architecture (`DialectFrame`): a Najdi parapet and door triangles for
  the Gulf, a Cairo mashrabiya under Mamluk crenellations for Egyptian, a
  Sana'a qamariya window over a gypsum frieze for Yemeni. A long name
  shrinks to fit (`titleFontSize`).
- **Vox touches:** an oxblood circle behind the dancer, a grid-paper scrap,
  paper tape, and ink label boxes for the cheer and the milestone.

Only the dancers are pictures. The paper, frame, title, labels and tape are
drawn in code, so they follow the brand and can carry live text.

## How the dancers move: pose swap

A dance is a handful of stills of one row of performers, or of a soloist. The
scene snaps from one still to the next on the beat. Where the footage
measures them, the row sways as one (`swayDeg`) or drops and rises on each
step (`bobPct`). A pose held over several beats either pumps on each one
(the Ardah's overhead) or stays still (`pumpOnHold`). Each swap lands with a small jolt, a slight tilt and a
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
| `src/components/celebrations/DialectFrame.tsx` | Picks the title's frame by dialect: `NajdiFrame`, `MashrabiyaFrame`, `QamariyaFrame` (sized by `frameTitle.ts`). |
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
   Ayyala; the Ardah's stills were cut before them. Two flags cover what
   the models miss: `--keep-grey` for a figure dressed in the backdrop's own
   grey (the Tahtib's drummer), and `--key-colour` for a coloured prop the
   models drop, such as the Razha's brown canes.

   The Mizmar, Sana'ani and Khammari stills were lined up before cutting:
   each scaled by a factor read off its head-to-feet height (checked on the
   vest or jacket) and moved so its feet sit on one floor line and the
   middle of its robe on one centre line.
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
- **Women's dances:** the Khammari is the one women's dance, drawn as
  generated photographic cutouts like every other dance, under the rules the
  owner set for #403 and the pack (television footage only, hair covered).
  An earlier version of this file suggested drawing women or silhouetting
  them instead; that was never decided, and the owner should say which before
  the Khammari ships. The Saidi cane dance stays a solo man, because no woman
  in its footage twirls, tosses or balances a cane, and the Sana'ani
  footage shows only men.
- **The Gulf frame is Najdi** for every Gulf dance, the Hejazi, Omani and
  Bahraini ones included. A frame per region (Hejazi rawashin, Omani
  doorways, Bahraini wind towers) is not drawn.
- **Sound:** the dance screen itself is silent. A separate sung celebration
  (PR #416, `useCelebrationSong`) plays on a lesson's finish and the day's
  goal, so on those two moments the learner gets the dance and a song
  together. A drum loop per dance (generated, timed to each dance's measured
  stroke) is still open; it would compete with the song.
- **Other milestones:** stage completion and weekly goals have no "crossing
  moment" on the client yet.
