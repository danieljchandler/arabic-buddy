import type { DialectModule } from "@/contexts/DialectContext";
import type { Cheer } from "@/lib/celebrations";

/**
 * The milestone dances: a few seconds of a traditional dance from the
 * learner's dialect, played as a cut-paper collage in the Ink brand.
 *
 * The look follows the collage explainers the owner chose (Telfaz11's
 * Folklore 101, Vox): grayscale photo cutouts with a rough paper edge, on flat
 * coloured paper, under a framed Arabic title. The dancers are a handful of
 * stills, snapped from pose to pose ("pose swap") rather than a video: every
 * frame is a still a native reviewer can approve, a set weighs about 200 KB,
 * and everything around the dancers is drawn in code so it follows the brand.
 * docs/celebrations.md has the production notes.
 *
 * Every pose is drawn from a reference keyframe and every timing number comes
 * from footage (docs/reference/<dance>/). This module is the catalogue and the
 * timing; it renders nothing. When a dance plays is `@/lib/celebrations`.
 */

/**
 * What the stage can draw in code over a scene's figure. The dances use none;
 * the vignettes (`@/lib/vignettes`) ask for them, because flames, smoke and
 * sparkle are cheaper and more on-brand drawn than photographed.
 */
export type SceneEffect = "fire" | "smoke" | "steam" | "sparkle" | "ink";

/** The stage's own stage directions for the scenes that aren't dances. */
export interface SceneExtras {
  /**
   * What the scene is, for screen readers, when it is not a dance: "a street
   * grill from the Gulf". Unset, the label reads "a dance from <region>".
   */
  about?: string;
  /** Effects drawn over the figure. */
  effects?: readonly SceneEffect[];
  /** How strong the effects are, 1 (a few sparks) to 5 (a blaze). Default 2. */
  heat?: number;
  /**
   * Where the effects rise from, as percentages of the figure's box from its
   * left and its top. Default: the middle, 60% of the way down.
   */
  fxAnchor?: { x: number; y: number };
  /** What the stage shouts for this scene before it falls back to the dialect's cheers. */
  cheers?: readonly Cheer[];
}

export interface DanceDefinition extends SceneExtras {
  id: string;
  /** The dialect whose learners see it. */
  dialect: DialectModule;
  /** The dance's name as it is written, for the framed title. */
  title: string;
  /** Latin transliteration, for the caption and screen readers. */
  gloss: string;
  /** Where it is danced, in English. */
  region: string;
  /** Milliseconds per pose change of the dancers. */
  beatMs: number;
  /** Milliseconds per change of the musician's still. */
  musicianMs: number;
  /** How far the dancers tilt each way in the sway, in degrees. 0: no sway. */
  swayDeg: number;
  /** One full sway, there and back, in milliseconds. */
  swayPeriodMs: number;
  /**
   * How far the dancers drop at the bottom of a bob (the knees bending and
   * the body folding on the step), as a percentage of their height on stage.
   * 0: no bob.
   */
  bobPct: number;
  /** One full bob, down and up, in milliseconds. */
  bobPeriodMs: number;
  /**
   * The order the dancers' stills are shown in, as 0-based indexes into the
   * scene's dancer images. Repeating the rest pose between the big moves keeps
   * the swap reading as a dance rather than a slideshow.
   */
  sequence: readonly number[];
  /** The order the musician's stills alternate in. Empty: no musician. */
  musicianSequence: readonly number[];
  /**
   * Whether a pose held over several beats lands its jolt again on each one.
   * True where the footage shows a pump per stroke while the pose is held
   * (the Ardah's overhead); false where a held pose is held still, so a
   * sequence can repeat a pose to give it its measured length.
   */
  pumpOnHold: boolean;
}

/*
 * The Ardah's timing, measured from the reference footage in
 * docs/reference/ardah/timing.md. The three performances run at slightly
 * different tempos, so one tempo is chosen (the drum cycle) and the rest is
 * derived from it, the way the timing notes recommend: the relationships
 * between the numbers held up better than any single figure.
 */
/**
 * One big-drum cycle. ardah2's drums: median 1172 ms over 302 twenty-second
 * windows (IQR 1167–1175), and 1190 ms from ten stick strikes timed frame by
 * frame. High confidence for ardah2.
 */
export const ARDAH_DRUM_STROKE_MS = 1170;
/**
 * One pose per drum cycle. The one shot where a row changes pose repeatedly
 * (ardah1 369.3–374.6 s) changes every 1.10–1.30 s, mean 1.20 s, against that
 * troupe's 1142 ms drum cycle. Locked to the cycle so the row and the drummer
 * stay in step. Low confidence: a single shot.
 */
export const ARDAH_BEAT_MS = ARDAH_DRUM_STROKE_MS;
/**
 * The drummer's two stills each hold half a cycle: the strike, then the stick
 * drawn back across the face (each drummer strikes once per cycle).
 */
export const ARDAH_DRUM_MS = ARDAH_DRUM_STROKE_MS / 2;
/**
 * One sway, there and back: two drum cycles. ardah3 measures 2175–2225 ms at
 * its own tempo, 6 pulses, which is two of its cycles; the rows' body rock in
 * ardah1 has a similar period (about 2.05–2.3 s, weak).
 */
export const ARDAH_SWAY_PERIOD_MS = 2 * ARDAH_DRUM_STROKE_MS;
/**
 * TODO(timing): the body rock's lean each way is not measured. The timing
 * notes measure about 45° each way for the BLADES swinging overhead (an arm
 * swing, not a body tilt); the scene tilts the whole row, which stands for the
 * gentler body rock seen in rest, so it stays small.
 */
export const ARDAH_SWAY_DEG = 3;

export const ARDAH: DanceDefinition = {
  id: "ardah",
  dialect: "Gulf",
  title: "العرضة",
  gloss: "Al-Ardah",
  region: "Najd, Saudi Arabia",
  beatMs: ARDAH_BEAT_MS,
  musicianMs: ARDAH_DRUM_MS,
  swayDeg: ARDAH_SWAY_DEG,
  swayPeriodMs: ARDAH_SWAY_PERIOD_MS,
  // The rows' movement in the timing notes is the sway and the blade swing;
  // no step bob was measured.
  bobPct: 0,
  bobPeriodMs: 0,
  // Drawn from the reference keyframes in docs/reference/ardah/ (numbers are
  // the README's entries):
  //   0 rest: sword at the chest, blade diagonal up the way the row faces (5, 6)
  //   1 swords forward at waist height, blades parallel, slightly down (7)
  //   2 sword arm straight up, blade tilted back, other hand open (8)
  // The order follows timing.md: rest and forward alternate, one per drum
  // cycle (ardah1 369.3–374.6 s), and overhead is a section of its own, held
  // for whole shots (≥ 26.8 s in ardah2) with the swords pumping once per
  // cycle, which the jolt on every beat stands for. No shot shows the change
  // into or out of overhead, so entering it from rest is an assumption, chosen
  // so the 6 s scene reaches it (at the fourth beat) and the 3 s one shows
  // the rest/forward alternation.
  sequence: [0, 1, 0, 2, 2, 2, 2],
  //   0 frame drum overhead, hooked stick against the face (9)
  //   1 drum at head height, stick held away from it (11)
  musicianSequence: [0, 1],
  // Overhead is held with the swords pumping once per drum cycle.
  pumpOnHold: true,
};

/*
 * The Ayyala's timing, measured from the reference footage in
 * docs/reference/ayyala/README.md (its Timing section). The dance runs on a
 * fast, even pulse, and both of its measured cycles are six strokes long, so
 * one step is one stroke and a pose is held for as many strokes as the
 * footage holds it.
 */
/**
 * One stroke of the pulse: ayyala3 0:30–1:00, median 343 ms (IQR 332–354), the
 * stretch where the cane cycle was hand counted. The pulse speeds up through
 * every film (ayyala3 343 → 319 ms; ayyala2 404 → 337 ms); this is the tempo
 * the cycle was measured at. Medium confidence.
 */
export const AYYALA_STROKE_MS = 343;
/** One step per stroke; the poses are held over several (see the sequence). */
export const AYYALA_BEAT_MS = AYYALA_STROKE_MS;
/**
 * The cane cycle: cane up about 0.5 s (0.3–0.7), arm out about 1.4 s
 * (1.1–1.6), repeating every 2.0 s ±0.1, about six strokes (ayyala3
 * 0:30.0–0:39.7, 10 fps strips). Two strokes up and four out keeps the six.
 */
export const AYYALA_CANE_UP_STROKES = 2;
export const AYYALA_ARM_OUT_STROKES = 4;
/**
 * The row's forward-and-bend cycle: canes splayed forward, then 1.2 s later
 * held in, every 2.42 s, about six strokes at that troupe's tempo (ayyala2
 * 8:20–8:30, optical flow with a pose check). Half and half.
 */
export const AYYALA_FORWARD_STROKES = 3;
export const AYYALA_BOW_STROKES = 3;
/**
 * No sway. The footage measured shows the bow and the cane cycle; a side to
 * side sway of the bodies was never separated from the bow, so none is drawn.
 */
export const AYYALA_SWAY_DEG = 0;

const repeat = (pose: number, strokes: number) => Array<number>(strokes).fill(pose);
const AYYALA_CANE_CYCLE = [...repeat(0, AYYALA_CANE_UP_STROKES), ...repeat(1, AYYALA_ARM_OUT_STROKES)];
const AYYALA_BOW_CYCLE = [...repeat(2, AYYALA_FORWARD_STROKES), ...repeat(3, AYYALA_BOW_STROKES)];

export const AYYALA: DanceDefinition = {
  id: "ayyala",
  dialect: "Gulf",
  title: "العيالة",
  gloss: "Al-Ayyala",
  region: "UAE and Oman",
  beatMs: AYYALA_BEAT_MS,
  musicianMs: AYYALA_BEAT_MS,
  swayDeg: AYYALA_SWAY_DEG,
  swayPeriodMs: 0,
  // The bow is drawn as a pose; no separate bob was measured.
  bobPct: 0,
  bobPeriodMs: 0,
  // Drawn from the reference keyframes in docs/reference/ayyala/ (numbers are
  // the README's entries):
  //   0 cane up: forearm raised, cane near vertical above the hand (6; the
  //     "cane up" of the Timing section, whose frames are not keyframes)
  //   1 arm out: arm forward and down, the cane's tip to the floor ahead (5)
  //   2 canes forward: arm out at chest height, cane rising at 45° (4)
  //   3 bow: bent forward at the hips, cane upright, crook in the hand (7)
  // Two cane cycles, then two of forward and bow. No shot shows a row change
  // from one cycle to the other (they are different troupes), so that change
  // is an assumption, placed so the 6 s scene reaches the bow (at 5.1 s) and
  // the 3 s one is the cane cycle alone.
  sequence: [...AYYALA_CANE_CYCLE, ...AYYALA_CANE_CYCLE, ...AYYALA_BOW_CYCLE, ...AYYALA_BOW_CYCLE],
  //   0 a frame drum held up at head height (9). Who strikes which drum, and
  //     how, is never readable in the footage, so the drummer doesn't strike.
  musicianSequence: [0],
  // A held pose is held: the footage shows no pump within one.
  pumpOnHold: false,
};

/*
 * The Saidi cane dance's timing, measured from the reference footage in
 * docs/reference/assaya/README.md (its Timing section). Everything measured
 * there is one solo man (assaya3), so the scene is that solo. His poses do not
 * follow a beat (they change every 100–900 ms, median 200–400), so the steps
 * are the music's main stroke, and each pose is held for the strokes nearest
 * its measured length.
 */
/**
 * The music's main interval: assaya3 2:30–3:46, median 249.6 ms in three
 * stretches, on a grid of 126 ms ticks with the accent about every 505 ms.
 * Medium confidence; audio only.
 */
export const ASSAYA_STROKE_MS = 250;
/**
 * While he spins, "cane horizontal in both hands" comes back every 1.17 s
 * (SD 0.19, 7 intervals), with the cane across the shoulders between.
 * Horizontal for three strokes (the pose, about 0.4–0.5 s, and the blurred
 * mid-turn frames after it) and the shoulders for two: a turn every 1.25 s.
 */
export const ASSAYA_SPIN_STROKES = 3;
export const ASSAYA_SHOULDERS_STROKES = 2;
/**
 * The cane stood upright over the hand: held 320–800 ms, mean 520 (4 holds,
 * assaya3 0:39.1–0:42.0), between quick changes of about 220–300 ms (a toss,
 * or the cane held out, 0:59.3–1:00.8). Two strokes up, one out.
 */
export const ASSAYA_UPRIGHT_STROKES = 2;
export const ASSAYA_HELD_OUT_STROKES = 1;

const ASSAYA_SPIN = [...repeat(0, ASSAYA_SPIN_STROKES), ...repeat(1, ASSAYA_SHOULDERS_STROKES)];
const ASSAYA_HOLDS = [...repeat(3, ASSAYA_UPRIGHT_STROKES), ...repeat(2, ASSAYA_HELD_OUT_STROKES)];

export const ASSAYA: DanceDefinition = {
  id: "assaya",
  dialect: "Egyptian",
  title: "رقص العصاية",
  gloss: "Raqs al-Assaya",
  region: "Upper Egypt",
  beatMs: ASSAYA_STROKE_MS,
  musicianMs: ASSAYA_STROKE_MS,
  // No sway and no bob: a solo man turning and stepping, not a row, and
  // his steps could not be counted (feet 5–8 px tall at 480p).
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: 0,
  bobPeriodMs: 0,
  // Drawn from the reference keyframes in docs/reference/assaya/ (numbers are
  // the README's entries), all of the solo man in assaya3:
  //   0 mid-spin on one foot, the cane across the chest in both hands (6)
  //   1 walking, the cane across the back of the shoulders (9)
  //   2 low lunge, the cane held up and out in one hand (8)
  //   3 standing, the cane upright over the hand (7)
  // The footage has no regular order. The two runs that do repeat are drawn:
  // the spin with the shoulders between, then upright holds with the cane
  // held out between (where he tosses it; no still shows a toss). The twirl
  // (2.59 turns a second) is a blur no still can show, so it is left out.
  sequence: [...ASSAYA_SPIN, ...ASSAYA_SPIN, ...ASSAYA_HOLDS, ...ASSAYA_HOLDS],
  // No musician: the band is never in view in assaya3.
  musicianSequence: [],
  pumpOnHold: false,
};

/*
 * The Tahtib's timing, measured from the reference footage in
 * docs/reference/tahtib/README.md (its Timing section). The fencing was
 * labelled pose by pose over 40 s of one pair (tahtib2); the drum, on the
 * same festival stage (tahtib3).
 */
/**
 * The drum's grid: onsets phase-locked to 133–135 ms in three stretches of
 * tahtib3 (R 0.33–0.50, low band p below 1e-10). Medium confidence.
 */
export const TAHTIB_GRID_MS = 134;
/**
 * The drum's figure, in grid steps: short, short, long (1-1-2 = 536 ms),
 * running in blocks of up to 11.7 cycles (tahtib3 3:12.0–3:18.2). The one
 * drummer whose strikes were matched to the sound plays a frame drum with the
 * open hand (2 of 2 strikes on the skin).
 */
export const TAHTIB_FIGURE_STEPS = [1, 1, 2] as const;
/**
 * The fencers' poses change every 303–484 ms on average, on no beat. A step
 * here is two grid steps (268 ms), near the shorter mean.
 */
export const TAHTIB_STEP_MS = 2 * TAHTIB_GRID_MS;
/**
 * One exchange: apart, crossed (held two steps), the swing. The commonest
 * transitions in the labelled stretch run apart to crossed, crossed to the
 * swing, the swing to apart (12, 12 and 13 of 65). Crossed segments last
 * 545 ms on average; an exchange comes every 0.8–1.2 s (median).
 */
export const TAHTIB_CROSSED_STEPS = 2;

/** The drummer's stills, on half grid steps: the hand on the skin, then lifted. */
function tahtibDrumFigure(): number[] {
  return TAHTIB_FIGURE_STEPS.flatMap((steps) => [0, ...repeat(1, 2 * steps - 1)]);
}

export const TAHTIB: DanceDefinition = {
  id: "tahtib",
  dialect: "Egyptian",
  title: "التحطيب",
  gloss: "Tahtib",
  region: "Upper Egypt",
  beatMs: TAHTIB_STEP_MS,
  musicianMs: TAHTIB_GRID_MS / 2,
  // A duel, not a row: no sway, and the robes hide the feet, so no step bob
  // could be measured.
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: 0,
  bobPeriodMs: 0,
  // Drawn from the reference keyframes in docs/reference/tahtib/ (numbers are
  // the README's entries), the pair of tahtib2:
  //   0 apart: sticks raised toward each other at about 50°, an open V (3)
  //   1 crossed: chest to chest, both sticks held level above the heads (4)
  //   2 the swing: one stick level at head height, the other raised to
  //     strike (6; the swing itself is a blur at 10 fps)
  // The footage has no fixed order and no repeating block; this is its
  // commonest round, repeated. No blow lands on a body in it, and none here.
  sequence: Array.from({ length: 3 }, () => [0, ...repeat(1, TAHTIB_CROSSED_STEPS), 2]).flat(),
  //   0 the open hand flat on the skin   1 the hand lifted (8)
  musicianSequence: tahtibDrumFigure(),
  pumpOnHold: false,
};

/*
 * Al-Bara's timing, measured from the reference footage in
 * docs/reference/baraa/README.md (its Timing section). The one movement the
 * footage measures well is the street dancers' bob (baraa2): they go down and
 * up together once per step, three drum pulses to a step.
 */
/**
 * One down-and-up of the dancers' bodies and feet: 430 ms (419–440 across
 * methods: optical flow in three stretches of baraa2 0:26–2:14, and a hand
 * count of 7 cycles in 3.04 s = 434 ms). High confidence, for that stretch.
 */
export const BARAA_BOB_MS = 430;
/**
 * The audio's pulse in the same stretches: 140–146 ms, three to a bob. Not
 * seen as strikes, so it times nothing on its own; the test holds it to the
 * bob.
 */
export const BARAA_PULSE_MS = 143;
/** A still holds half a bob: folded at the bottom, taller at the top. */
export const BARAA_STEP_MS = BARAA_BOB_MS / 2;
/**
 * How far the bob drops them: the head top moves about 5% of body height
 * (2–7%, four frames on a pixel grid). The bodies fill about 90% of the
 * row's box on stage, so 4.5% of the box.
 */
export const BARAA_BOB_PCT = 4.5;
/**
 * The three poses come in this order in baraa2 0:26–0:46, held 6.4 s, 1.2 s
 * and 12.4 s. Scaled to a loop of ten bobs, keeping order and proportion.
 */
export const BARAA_HEAD_BOBS = 3;
export const BARAA_LOW_BOBS = 1;
export const BARAA_WAIST_BOBS = 6;

export const BARAA: DanceDefinition = {
  id: "baraa",
  dialect: "Yemeni",
  title: "البرع",
  gloss: "Al-Bara'",
  region: "Yemen",
  beatMs: BARAA_STEP_MS,
  musicianMs: BARAA_STEP_MS,
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: BARAA_BOB_PCT,
  bobPeriodMs: BARAA_BOB_MS,
  // Drawn from the reference keyframes in docs/reference/baraa/ (numbers are
  // the README's entries), the street Bara' of baraa2:
  //   0 upright, the dagger in a fist at waist-to-chest height, blade level (3)
  //   1 upright, the blade up beside the head, the fist at the forehead (4)
  //   2 folded forward, the blade held level at the brow (4, frame-left man)
  //   3 knees deeply bent, feet wide, the dagger low at the side (5)
  // The blade-at-the-head section alternates 1 and 2 on the bob: the README
  // has the frame-left dancer going between them at 0:26–0:29, and the frames
  // at the bob's low point folded forward.
  sequence: [
    ...Array.from({ length: BARAA_HEAD_BOBS }, () => [1, 2]).flat(),
    ...repeat(3, 2 * BARAA_LOW_BOBS),
    ...repeat(0, 2 * BARAA_WAIST_BOBS),
  ],
  //   0 the drummer, a big round drum on a strap at the hip, a stick in each
  //     hand (3). No stroke lands in any frame, so he doesn't strike.
  musicianSequence: [0],
  // A held pose rides the bob; it doesn't jolt as well.
  pumpOnHold: false,
};

/*
 * The Tanoura's timing, measured from the reference footage in
 * docs/reference/tanoura/README.md (its Timing section). The movement is the
 * spin, so the stills are the spin: the same dancer a quarter turn apart.
 */
/**
 * One full turn: 0.994 s for the yellow-top dancer (tanoura6 4:00.2–4:19.1,
 * 19 turns hand counted, SD 0.07 s), the dancer whose lift was timed. Other
 * dancers and moments run 0.81–1.46 s. Medium confidence.
 */
export const TANOURA_TURN_MS = 990;
/**
 * A still per quarter turn: front, profile facing frame-right, back,
 * profile facing frame-left. That order is the yellow-top dancer's,
 * counter-clockwise seen from above.
 */
export const TANOURA_QUARTER_MS = TANOURA_TURN_MS / 4;
/**
 * Turns with the skirt spinning at the hips before the lift, and turns with
 * the upper layer held overhead. The footage holds it overhead about 7.1 s
 * (tanoura6) and 8.6 s (tanoura1); two turns stand in for that here.
 */
export const TANOURA_HIP_TURNS = 2;
export const TANOURA_OVERHEAD_TURNS = 2;

export const TANOURA: DanceDefinition = {
  id: "tanoura",
  dialect: "Egyptian",
  title: "التنورة",
  gloss: "Tanoura",
  region: "Cairo, Egypt",
  beatMs: TANOURA_QUARTER_MS,
  musicianMs: TANOURA_QUARTER_MS,
  // He spins in place: no sway, and no bob was measured.
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: 0,
  bobPeriodMs: 0,
  // Drawn from the reference keyframes in docs/reference/tanoura/ (numbers
  // are the README's entries), the yellow-top dancer of tanoura6 (4):
  //   0 front, the skirt a flat disc at the hips, arms out
  //   1 profile, facing frame-right    2 back    3 profile, facing frame-left
  //     (the quarter-turn views the turn count reads: front, profile, back,
  //     profile; README 4b)
  //   4 front, arms straight up, the upper layer held overhead as a disc (4)
  //   5 back, the same
  // The lift itself takes about 290 ms, one quarter-turn step here, so the
  // scene goes straight from the hip disc to the disc overhead. Overhead he
  // is drawn front and back only: two stills for the four views.
  sequence: [
    ...Array.from({ length: TANOURA_HIP_TURNS }, () => [0, 1, 2, 3]).flat(),
    ...Array.from({ length: TANOURA_OVERHEAD_TURNS }, () => [4, 4, 5, 5]).flat(),
  ],
  //   0 a frame drum held against the chest (10). No stroke can be matched
  //     to the sound (README 4a), so he doesn't strike.
  musicianSequence: [0],
  // Every step is a new view of the turn; overhead the front and back views
  // are each held for half a turn, still.
  pumpOnHold: false,
};

/*
 * Al-Mizmar's timing, measured from the reference footage in
 * docs/reference/mizmar/README.md (its Timing section). The one steady clock
 * in it is the rows' slow clap; the dancers' poses were labelled over 60 s of
 * one troupe (mizmar10) and follow no beat and no fixed order.
 */
/**
 * One clap of the rows: 1317 ms (mizmar10 4:38–5:32, 22 intervals, SD
 * 18.5 ms), and the picture shows the palms meeting on 9 of 10 onsets within
 * a frame. Medium confidence: one video, audio and picture agree.
 */
export const MIZMAR_CLAP_MS = 1317;
/**
 * The dancers' step: an eighth of a clap, 165 ms. The labelled take's own
 * pulse is 166–168 ms; an eighth of the clap is within 2% of it and keeps the
 * clapper and the dancer on one clock.
 */
export const MIZMAR_PULSE_MS = MIZMAR_CLAP_MS / 8;
/**
 * Holds, in pulses, from the mean of each pose's labelled segments: the
 * stride 693 ms (4 pulses), the stick overhead 433 ms (3). The twirl is one
 * revolution of the stick, 630 ms in the one clean count (4 pulses).
 */
export const MIZMAR_STRIDE_PULSES = 4;
export const MIZMAR_OVERHEAD_PULSES = 3;
export const MIZMAR_TWIRL_PULSES = 4;
/** The palms meet for about three frames at 24 fps (125 ms): one pulse. */
export const MIZMAR_CLAP_CONTACT_PULSES = 1;

export const MIZMAR: DanceDefinition = {
  id: "mizmar",
  dialect: "Gulf",
  title: "المزمار",
  gloss: "Al-Mizmar",
  region: "Hejaz, Saudi Arabia",
  beatMs: MIZMAR_PULSE_MS,
  musicianMs: MIZMAR_PULSE_MS,
  // A dancer between the rows, not a row: no sway, and the hop (292 ms
  // between landings, one dancer, one moment) is not tied to the pulse.
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: 0,
  bobPeriodMs: 0,
  // Drawn from the reference keyframes in docs/reference/mizmar/ (numbers are
  // the README's entries), one dancer in mizmar10's troupe costume:
  //   0 stride, the hand at head height, the cane down to the floor ahead (10)
  //   1 stride, the cane held vertical above the head (7)
  //   2 mid-step, the cane level above the head, half way round a twirl (4)
  // There is no fixed order: stride is the commonest and longest, and the
  // others come between strides. Sticks meeting takes two dancers, so the
  // solo leaves it out.
  sequence: [
    ...repeat(0, MIZMAR_STRIDE_PULSES),
    ...repeat(1, MIZMAR_OVERHEAD_PULSES),
    ...repeat(0, MIZMAR_STRIDE_PULSES),
    ...repeat(2, MIZMAR_TWIRL_PULSES),
    ...repeat(0, MIZMAR_STRIDE_PULSES),
    ...repeat(1, MIZMAR_OVERHEAD_PULSES),
  ],
  //   0 hands apart, the cane against the shoulder   1 the palms meet (6)
  // One clap every eight pulses.
  musicianSequence: [
    ...repeat(1, MIZMAR_CLAP_CONTACT_PULSES),
    ...repeat(0, MIZMAR_CLAP_MS / MIZMAR_PULSE_MS - MIZMAR_CLAP_CONTACT_PULSES),
  ],
  pumpOnHold: false,
};

/*
 * Al-Razha's timing, measured from the reference footage in
 * docs/reference/razha/README.md (its Timing section). The row's canes change
 * state every 3–14 s, on neither the drums' stroke nor their accent; the
 * stretch timed is razha12 6:20–7:00.
 */
/**
 * The drums' accent: every fourth stroke of about 197 ms, about 775 ms
 * (razha12, core medians 192–197 ms in five stretches). Medium confidence; no
 * visible strike could be matched to the sound.
 */
export const RAZHA_ACCENT_MS = 775;
/**
 * How long each cane state lasts, in accents: upright 3.1 s (4), raised and
 * crossing 3.9 s (5), held low 4.0 s (5), then upright again 12.4 s (16).
 */
export const RAZHA_UPRIGHT_ACCENTS = 4;
export const RAZHA_CROSSING_ACCENTS = 5;
export const RAZHA_LOW_ACCENTS = 5;
export const RAZHA_LONG_UPRIGHT_ACCENTS = 16;

export const RAZHA: DanceDefinition = {
  id: "razha",
  dialect: "Gulf",
  title: "الرزحة",
  gloss: "Al-Razha",
  region: "Oman",
  beatMs: RAZHA_ACCENT_MS,
  musicianMs: RAZHA_ACCENT_MS,
  // The men step in place with their feet on the ground, and no sway or bob
  // could be counted (hand-held cameras, no repeating crest).
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: 0,
  bobPeriodMs: 0,
  // Drawn from the reference keyframes in docs/reference/razha/ (numbers are
  // the README's entries), a row of razha12 seen from its end:
  //   0 canes upright, hooks up, held at chest to belt height (2)
  //   1 canes raised diagonally across the body at about 45°, crossing (3)
  //   2 canes held low, slanting down and forward (the Timing section's
  //     "held low", 6:27–6:31; no keyframe)
  // The scene opens on the last two accents of the first stand, so the
  // three-second scene reaches the crossing and the six the low hold. The
  // later "raised forward and up" (14.4 s) comes after the longest scene ends,
  // so it is not drawn.
  sequence: [
    ...repeat(0, RAZHA_UPRIGHT_ACCENTS / 2),
    ...repeat(1, RAZHA_CROSSING_ACCENTS),
    ...repeat(2, RAZHA_LOW_ACCENTS),
    ...repeat(0, RAZHA_LONG_UPRIGHT_ACCENTS),
  ],
  //   0 a barrel drum on a rope sling, the stick raised (6). No stroke lands
  //     in any frame, so he doesn't strike.
  musicianSequence: [0],
  pumpOnHold: false,
};

/*
 * The Khammari's timing, measured from the reference footage in
 * docs/reference/gulf-women/README.md (its Timing section): video 1, the
 * Bahrain TV recording, where the women bow and lean while the men drum.
 */
/**
 * The music's grid: about 234 ms, two steps to its 464 ms beat (video 1
 * 7:48–8:40). Medium confidence; audio only.
 */
export const KHAMMARI_GRID_MS = 234;
/**
 * The right-end woman's change points (video 1 7:54.0–8:04.1), in grid steps:
 * lean 0.3 s, bow 1.6 s, lean 0.5 s, upright 1.7 s, lean 1.0 s, upright 2.8 s,
 * and the next bow follows. The scene opens on the last 0.9 s of the upright
 * before the first lean, so the three-second scene reaches the bow.
 */
export const KHAMMARI_STEPS = {
  openingUpright: 4,
  firstLean: 1,
  bow: 7,
  secondLean: 2,
  upright: 7,
  thirdLean: 4,
  longUpright: 8,
} as const;

export const KHAMMARI: DanceDefinition = {
  id: "khammari",
  dialect: "Gulf",
  title: "الخماري",
  gloss: "Al-Khammari",
  region: "Bahrain",
  beatMs: KHAMMARI_GRID_MS,
  musicianMs: KHAMMARI_GRID_MS,
  // The dips are drawn as poses; no sway or step bob was measured.
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: 0,
  bobPeriodMs: 0,
  // Drawn from the reference keyframes in docs/reference/gulf-women/
  // (numbers are the README's entries), the women of video 1:
  //   0 upright, hands together at the waist (1)
  //   1 lean: head and shoulders dipped, less than a bow (the Timing
  //     section's "lean"; no keyframe)
  //   2 bow: bent forward from the waist, about 18°, head down (3)
  // Deep bow and shallow lean alternate, as the footage's block of six does.
  sequence: [
    ...repeat(0, KHAMMARI_STEPS.openingUpright),
    ...repeat(1, KHAMMARI_STEPS.firstLean),
    ...repeat(2, KHAMMARI_STEPS.bow),
    ...repeat(1, KHAMMARI_STEPS.secondLean),
    ...repeat(0, KHAMMARI_STEPS.upright),
    ...repeat(1, KHAMMARI_STEPS.thirdLean),
    ...repeat(0, KHAMMARI_STEPS.longUpright),
  ],
  //   0 a man holding a frame drum at the chest (4). No stroke can be
  //     matched to the sound, so he doesn't strike.
  musicianSequence: [0],
  pumpOnHold: false,
};

/*
 * The Sana'ani dance's timing, measured from the reference footage in
 * docs/reference/sanaani/README.md (its Timing section): sanaani17, the
 * heritage film, where a line of men holds hands, lets go, walks and joins
 * up again in a 13.2 s cycle while bobbing about twice a second.
 */
/**
 * One down-and-up of the bodies: 535 ms (sanaani17, optical flow and a head
 * tracker within 1%; 484–547 across shots). It is not tied to that film's
 * track, so the bob is the scene's clock.
 */
export const SANAANI_BOB_MS = 535;
/**
 * How far the bob drops them: 2–6% of standing height peak to peak
 * (sanaani17 only); the bodies fill about 90% of the row's box. Low
 * confidence.
 */
export const SANAANI_BOB_PCT = 3.5;
/**
 * The cycle, in bobs: the chain about 11 s and the regrouping about 1 s
 * (22 bobs between them; the regrouping has no keyframe, so the chain stands
 * for it), the release walk about 1.5 s (3 bobs).
 */
export const SANAANI_CHAIN_BOBS = 22;
export const SANAANI_RELEASE_BOBS = 3;
/** Bobs of the chain before the release, so the three-second scene shows it. */
export const SANAANI_OPENING_BOBS = 3;

export const SANAANI: DanceDefinition = {
  id: "sanaani",
  dialect: "Yemeni",
  title: "الرقص الصنعاني",
  gloss: "Al-Raqs al-San'ani",
  region: "Sana'a, Yemen",
  beatMs: SANAANI_BOB_MS,
  musicianMs: SANAANI_BOB_MS,
  swayDeg: 0,
  swayPeriodMs: 0,
  bobPct: SANAANI_BOB_PCT,
  bobPeriodMs: SANAANI_BOB_MS,
  // Drawn from the reference keyframes in docs/reference/sanaani/ (numbers
  // are the README's entries), the men of sanaani17:
  //   0 the chain: hands joined, arms out at shoulder height, facing out (1)
  //   1 the release: hands free, walking across the floor, from behind (3)
  sequence: [
    ...repeat(0, SANAANI_OPENING_BOBS),
    ...repeat(1, SANAANI_RELEASE_BOBS),
    ...repeat(0, SANAANI_CHAIN_BOBS - SANAANI_OPENING_BOBS),
  ],
  //   0 an oud player singing, seated (8, sanaani62). No stroke can be
  //     matched to the sound, so the still doesn't change.
  musicianSequence: [0],
  // A held pose rides the bob; it doesn't jolt as well.
  pumpOnHold: false,
};

/**
 * Every dance, in rotation order within each dialect. Order alternates kinds
 * of dance where a dialect has several, so two celebrations in a row rarely
 * look alike.
 */
export const DANCES: readonly DanceDefinition[] = [
  ARDAH,
  AYYALA,
  MIZMAR,
  KHAMMARI,
  RAZHA,
  ASSAYA,
  TANOURA,
  TAHTIB,
  BARAA,
  SANAANI,
];

/**
 * The dances a dialect's learners rotate through. Empty while a dialect has
 * none drawn yet; the celebration still plays, without dancers.
 */
export function dancesFor(dialect: DialectModule): DanceDefinition[] {
  return DANCES.filter((d) => d.dialect === dialect);
}

export function danceById(id: string): DanceDefinition | null {
  return DANCES.find((d) => d.id === id) ?? null;
}

/** A small, stable pseudo-random number in [0, 1) for a given step. */
export function jitter(step: number, salt = 0): number {
  const x = Math.sin((step + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface PoseFrame {
  /** How many beats have passed. */
  step: number;
  /**
   * The beat the current still was put down on: `step`, unless the dance
   * holds a repeated pose still (`pumpOnHold` false), when it is the beat the
   * pose began. The jolt and the hand-placed wobble belong to this beat.
   */
  swapStep: number;
  /** Index into the dancers' stills. */
  pose: number;
  /** A slight tilt on each swap, in degrees, so every frame looks hand-placed. */
  rotateDeg: number;
  /** A slight sideways shift on each swap, as a percentage of the dancers' width. */
  shiftPct: number;
  /** Index into the musician's stills. */
  musicianPose: number;
}

/**
 * What is on stage at `elapsedMs` into the dance. Pure, so the scene and its
 * tests agree on every frame. The first beat is always the sequence's first
 * pose, untilted, so a still render (reduced motion, a screenshot) is clean.
 */
export function poseAt(dance: DanceDefinition, elapsedMs: number): PoseFrame {
  const step = Math.max(0, Math.floor(elapsedMs / dance.beatMs));
  const stroke = Math.max(0, Math.floor(elapsedMs / dance.musicianMs));
  const pose = dance.sequence[step % dance.sequence.length];
  const musicians = dance.musicianSequence;
  const musicianPose = musicians.length ? musicians[stroke % musicians.length] : 0;
  const n = dance.sequence.length;
  let swapStep = step;
  if (!dance.pumpOnHold) {
    // Walk back to the beat this pose began on (at most one lap).
    while (swapStep > 0 && step - swapStep < n - 1 && dance.sequence[(swapStep - 1) % n] === pose) swapStep--;
  }
  if (swapStep === 0) return { step, swapStep, pose, rotateDeg: 0, shiftPct: 0, musicianPose };
  return {
    step,
    swapStep,
    pose,
    // Kept small: the sway already tilts the dancers, and the wobble only has to
    // say "placed by hand", not move the dancers.
    rotateDeg: (jitter(swapStep) - 0.5) * 3,
    shiftPct: (jitter(swapStep, 1) - 0.5) * 4,
    musicianPose,
  };
}
