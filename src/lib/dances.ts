import type { DialectModule } from "@/contexts/DialectContext";

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

export interface DanceDefinition {
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
  // No sway: a solo man turning and stepping, not a row.
  swayDeg: 0,
  swayPeriodMs: 0,
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

/**
 * Every dance, in rotation order within each dialect. Order alternates kinds
 * of dance where a dialect has several, so two celebrations in a row rarely
 * look alike.
 */
export const DANCES: readonly DanceDefinition[] = [ARDAH, AYYALA, ASSAYA];

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
