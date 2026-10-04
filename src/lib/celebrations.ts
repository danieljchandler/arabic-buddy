/**
 * Milestone celebrations: a few seconds of a traditional dance from the
 * learner's dialect, played as a cut-paper collage in the Ink brand.
 *
 * The look follows the collage explainers the owner chose (Telfaz11's
 * Folklore 101, Vox): grayscale photo cutouts with a rough paper edge, on flat
 * coloured paper, under a framed Arabic title. The dancers are a handful of
 * stills of one row of performers, snapped from pose to pose ("pose swap")
 * rather than a video: every frame is a still a native reviewer can approve,
 * the set weighs about 200 KB, and everything around the dancer is drawn in
 * code so it follows the brand. docs/celebrations.md has the production notes.
 *
 * This module is the timing and the catalogue; it renders nothing.
 */

export type CelebrationTier = "small" | "medium" | "large";

/** How long each tier plays before it dismisses itself. */
export const TIER_DURATION_MS: Record<CelebrationTier, number> = {
  small: 1500,
  medium: 3000,
  large: 6000,
};

export interface DanceDefinition {
  id: string;
  /** The dialect whose learners see it. */
  dialect: string;
  /** The dance's name as it is written, for the framed title. */
  title: string;
  /** Latin transliteration, for the caption and screen readers. */
  gloss: string;
  /** Where it is danced, in English. */
  region: string;
  /** Praise in the dialect, shown in the label box. */
  praise: string;
  /** Milliseconds per pose change of the row. */
  beatMs: number;
  /** Milliseconds per change of the drummer's still. */
  drumMs: number;
  /** How far the whole row tilts each way in the sway, in degrees. */
  swayDeg: number;
  /** One full sway, there and back, in milliseconds. */
  swayPeriodMs: number;
  /**
   * The order the row's stills are shown in, as 0-based indexes into the
   * scene's row images. Repeating the rest pose between the big moves keeps
   * the swap reading as a dance rather than a slideshow.
   */
  sequence: readonly number[];
  /** The order the drummer's stills alternate in. */
  drummerSequence: readonly number[];
}

/*
 * The Ardah's timing. TODO: every number here is a placeholder, not a
 * measurement. Time them from the 30-second reference clips (drums in
 * clip_ardah1 and clip_ardah2, the sway at the start of clip_ardah3), which
 * are in Drive, not in the repo. docs/reference/ardah/README.md lists them.
 */
/** TODO(timing): time between the row's pose changes, in ms. Placeholder. */
export const ARDAH_BEAT_MS = 600;
/** TODO(timing): the drummer's stroke. Placeholder: twice per pose change. */
export const ARDAH_DRUM_MS = 300;
/** TODO(timing): the sway's lean each way. Placeholder, and no keyframe shows it. */
export const ARDAH_SWAY_DEG = 3;
/** TODO(timing): one sway, there and back. Placeholder. */
export const ARDAH_SWAY_PERIOD_MS = 2400;

export const ARDAH: DanceDefinition = {
  id: "ardah",
  dialect: "gulf",
  title: "العرضة",
  gloss: "Al-Ardah",
  region: "Najd, Saudi Arabia",
  praise: "كفو!",
  beatMs: ARDAH_BEAT_MS,
  drumMs: ARDAH_DRUM_MS,
  swayDeg: ARDAH_SWAY_DEG,
  swayPeriodMs: ARDAH_SWAY_PERIOD_MS,
  // Drawn from the reference keyframes in docs/reference/ardah/ (numbers are
  // the README's entries):
  //   0 rest: sword at the chest, blade diagonal up the way the row faces (5, 6)
  //   1 swords forward at waist height, blades parallel, slightly down (7)
  //   2 sword arm straight up, blade tilted back, other hand open (8)
  // The order is an assumption: the stills show the poses, not their order.
  // TODO(timing): check it against the clips.
  sequence: [0, 1, 0, 2],
  //   0 frame drum overhead, hooked stick against the face (9)
  //   1 drum at head height, stick held away from it (11)
  drummerSequence: [0, 1],
};

const DANCES: readonly DanceDefinition[] = [ARDAH];

/**
 * The dance for a learner's dialect, or null while that dialect has none yet.
 * A null means "celebrate the way the app did before", not "don't celebrate".
 */
export function danceForDialect(dialect: string | null | undefined): DanceDefinition | null {
  if (!dialect) return null;
  // DialectContext says "Gulf"; <html data-dialect> and the profile say "gulf".
  const key = dialect.toLowerCase();
  return DANCES.find((d) => d.dialect === key) ?? null;
}

export function danceById(id: string): DanceDefinition | null {
  return DANCES.find((d) => d.id === id) ?? null;
}

/**
 * `?celebrate=ardah` plays a dance on any page, so a scene can be reviewed
 * without finishing a lesson for the first time (which only happens once).
 * A tier can follow: `?celebrate=ardah-large`. Medium when it doesn't.
 */
export const CELEBRATE_PARAM = "celebrate";

export function parseCelebrateParam(search: string): { dance: DanceDefinition; tier: CelebrationTier } | null {
  const raw = new URLSearchParams(search).get(CELEBRATE_PARAM);
  if (!raw) return null;
  const [id, tierPart] = raw.trim().toLowerCase().split("-");
  const dance = danceById(id);
  if (!dance) return null;
  const tier: CelebrationTier = tierPart === "small" || tierPart === "large" ? tierPart : "medium";
  return { dance, tier };
}

/** A small, stable pseudo-random number in [0, 1) for a given step. */
export function jitter(step: number, salt = 0): number {
  const x = Math.sin((step + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface PoseFrame {
  /** How many beats have passed. */
  step: number;
  /** Index into the row's stills. */
  pose: number;
  /** A slight tilt on each swap, in degrees, so every frame looks hand-placed. */
  rotateDeg: number;
  /** A slight sideways shift on each swap, as a percentage of the row's width. */
  shiftPct: number;
  /** Index into the drummer's stills. */
  drummerPose: number;
}

/**
 * What is on stage at `elapsedMs` into the dance. Pure, so the scene and its
 * tests agree on every frame. The first beat is always the sequence's first
 * pose, untilted, so a still render (reduced motion, a screenshot) is clean.
 */
export function poseAt(dance: DanceDefinition, elapsedMs: number): PoseFrame {
  const step = Math.max(0, Math.floor(elapsedMs / dance.beatMs));
  const stroke = Math.max(0, Math.floor(elapsedMs / dance.drumMs));
  const pose = dance.sequence[step % dance.sequence.length];
  const drummerPose = dance.drummerSequence[stroke % dance.drummerSequence.length];
  if (step === 0) return { step, pose, rotateDeg: 0, shiftPct: 0, drummerPose };
  return {
    step,
    pose,
    // Kept small: the sway already tilts the row, and the wobble only has to
    // say "placed by hand", not move the dancers.
    rotateDeg: (jitter(step) - 0.5) * 3,
    shiftPct: (jitter(step, 1) - 0.5) * 4,
    drummerPose,
  };
}
