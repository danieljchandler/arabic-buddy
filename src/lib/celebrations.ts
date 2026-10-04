/**
 * Milestone celebrations: a few seconds of a traditional dance from the
 * learner's dialect, played as a cut-paper collage in the Ink brand.
 *
 * The look follows the collage explainers the owner chose (Telfaz11's
 * Folklore 101, Vox): grayscale photo cutouts with a rough paper edge, on flat
 * coloured paper, under a framed Arabic title. The dancers are a handful of
 * stills of one performer, snapped from pose to pose on the beat ("pose swap")
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
  /** Milliseconds per beat. Every pose change lands on one. */
  beatMs: number;
  /**
   * The order the dancer's stills are shown in, as 0-based indexes into the
   * scene's dancer images. Repeating a "home" pose between the big moves keeps
   * the swap reading as a dance rather than a slideshow.
   */
  sequence: readonly number[];
  /** The drummer's two stills alternate on each half beat. */
  drummerSequence: readonly number[];
}

export const ARDAH: DanceDefinition = {
  id: "ardah",
  dialect: "gulf",
  title: "العرضة",
  gloss: "Al-Ardah",
  region: "Najd, Saudi Arabia",
  praise: "كفو!",
  // PROVISIONAL. The tempo and the poses below were written from general
  // knowledge and generated, not taken from footage of a real Ardah. The
  // dip, the stamp and the leap are probably not Ardah moves at all. Redo the
  // stills and the timing from reference footage, with a Saudi reviewer,
  // before this ships to learners (docs/celebrations.md, "Status").
  beatMs: 460,
  // 0 sword up · 1 dip, sword across · 2 sword out, stamp · 3 leap
  // 4 sword overhead in both hands · 5 sway left
  sequence: [0, 1, 5, 1, 2, 1, 4, 1, 3, 1],
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
  /** Index into the dancer's stills. */
  pose: number;
  /** A slight tilt on each swap, in degrees, so every frame looks hand-placed. */
  rotateDeg: number;
  /** A slight sideways shift on each swap, as a percentage of the dancer's width. */
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
  const half = Math.max(0, Math.floor((elapsedMs * 2) / dance.beatMs));
  const pose = dance.sequence[step % dance.sequence.length];
  const drummerPose = dance.drummerSequence[half % dance.drummerSequence.length];
  if (step === 0) return { step, pose, rotateDeg: 0, shiftPct: 0, drummerPose };
  return {
    step,
    pose,
    rotateDeg: (jitter(step) - 0.5) * 5,
    shiftPct: (jitter(step, 1) - 0.5) * 6,
    drummerPose,
  };
}
