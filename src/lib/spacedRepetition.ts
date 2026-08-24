/**
 * FSRS-5 Spaced Repetition Algorithm
 *
 * Free Spaced Repetition Scheduler v5 — the algorithm Anki ships (24.11+).
 * Substantially outperforms SM-2, and improves on FSRS-4.5 by modelling
 * same-day (short-term) reviews, which 4.5 could not represent at all.
 *
 * Key ideas:
 *   - Uses stability (S) instead of an ease factor: S = days until 90% retention
 *   - Uses difficulty (D, 1–10) to modulate stability growth
 *   - Forgetting curve: R(t,S) = (1 + FACTOR × t/S)^DECAY
 *   - Stability after recall grows from current difficulty + retrievability
 *   - Stability after forgetting uses a separate formula, capped at the
 *     pre-lapse stability (forgetting can only ever lower the estimate)
 *   - A review on the *same day* as the last one uses the dedicated
 *     short-term formula S′ = S · e^(w17 · (G − 3 + w18)). Without it, a
 *     re-rated card has retrievability ≈ 1, the growth term collapses to
 *     zero, and Hard/Good/Easy all produce the *identical* interval — the
 *     "every button says 13d" bug.
 *
 * State stored per card:
 *   ease_factor  → stability S (days to 90% retention)
 *   difficulty   → difficulty D (1–10)
 *   interval_days → last scheduled interval (rounded stability)
 *   repetitions  → number of completed (graduated) reviews
 *
 * Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewResult {
  /** FSRS stability — days until retention drops to 90%. Stored in ease_factor column. */
  stability: number;
  /** FSRS difficulty — 1 (easiest) to 10 (hardest). Stored in difficulty column. */
  difficulty: number;
  intervalDays: number;
  repetitions: number;
  nextReviewAt: Date;
}

// ── FSRS-5 default parameters ─────────────────────────────────────────────────
// The stock 19-weight parameter set shipped with Anki/py-fsrs, trained on
// ~10k Anki collections. Can be personalised per-user with the optimizer;
// these defaults work well for most learners.
const W = [
  0.40255,  // w0:  S₀ for Again
  1.18385,  // w1:  S₀ for Hard
  3.173,    // w2:  S₀ for Good
  15.69105, // w3:  S₀ for Easy
  7.1949,   // w4:  D₀ base
  0.5345,   // w5:  D₀ exponent
  1.4604,   // w6:  difficulty delta weight
  0.0046,   // w7:  difficulty mean-reversion weight
  1.54575,  // w8:  recall stability: base exponent
  0.1192,   // w9:  recall stability: S^(-w9)
  1.01925,  // w10: recall stability: R factor
  1.9395,   // w11: forget stability: multiplier
  0.11,     // w12: forget stability: D^(-w12)
  0.29605,  // w13: forget stability: (S+1)^w13
  2.2698,   // w14: forget stability: R factor
  0.2315,   // w15: Hard penalty
  2.9898,   // w16: Easy bonus
  0.51655,  // w17: short-term (same-day) stability: rating weight
  0.6621,   // w18: short-term (same-day) stability: rating offset
];

const DECAY  = -0.5;
const FACTOR = 19 / 81; // ≈ 0.2346 — derived from DECAY and 90% retention target

/** Stability bounds — the model's estimate, not the schedule. */
const MIN_STABILITY = 0.1;
const MAX_STABILITY = 36500; // Anki's default maximum interval, ~100 years

// ── Personalisation options ───────────────────────────────────────────────────

export interface ScheduleOptions {
  /**
   * Target recall probability at review time. FSRS stores stability as "days
   * until retention drops to 90%"; the forgetting curve converts it to an
   * interval for any other target: t = S × (R^(1/DECAY) − 1) / FACTOR.
   * 0.9 (the default) leaves intervals exactly as before; lower means fewer,
   * longer reviews with more forgetting; higher means the reverse. Clamped to
   * [0.7, 0.97] — outside that the curve asks for absurd intervals.
   */
  desiredRetention?: number;
  /**
   * Correction for how this learner's real recall compares with the target
   * the scheduler aims at — see {@link calibrationMultiplier}. 1 (the
   * default) leaves intervals exactly as before.
   */
  stabilityMultiplier?: number;
  /**
   * When set (any stable per-card string — the card id), intervals of 3+ days
   * get a deterministic ±5% fuzz so cards created or imported together don't
   * all land due on the same future day. Deterministic per (card, interval):
   * the same rating previewed twice or applied after a preview yields the
   * same number. Absent = no fuzz, which keeps historical behaviour.
   */
  fuzzSeed?: string;
}

/** Interval multiplier for a desired retention; 1.0 at the 90% default. */
export function retentionFactor(desiredRetention: number | undefined): number {
  const r = Math.min(0.97, Math.max(0.7, desiredRetention ?? 0.9));
  return (Math.pow(r, 1 / DECAY) - 1) / FACTOR;
}

// ── Per-learner calibration ───────────────────────────────────────────────────

/**
 * Reviews (successful ones, summed across the learner's cards) below which no
 * correction is applied at all. A handful of cards is noise, and a wrong
 * correction schedules worse than the untouched defaults.
 */
export const MIN_REVIEWS_TO_CALIBRATE = 150;

/**
 * Shrinkage constant. The correction is blended toward 1.0 with weight
 * n / (n + K), so it arrives gradually as evidence accumulates instead of
 * lurching the moment the threshold is crossed.
 */
const CALIBRATION_SHRINKAGE = 400;

/** Hard bounds. Even with abundant evidence, never halve or 1.5× a schedule. */
const CALIBRATION_MIN = 0.7;
const CALIBRATION_MAX = 1.5;

/**
 * How much this learner's real memory outruns (or falls short of) the stock
 * FSRS parameters, as a multiplier on stability at scheduling time.
 *
 * The FSRS weights are trained on thousands of Anki users and are the same
 * for everyone here. Fitting all nineteen per learner is the full optimiser
 * and needs a per-review event log this app does not keep. But one number —
 * is this learner's memory stronger or weaker than the defaults assume? — is
 * recoverable from state already stored, and carries most of the benefit.
 *
 * FSRS schedules every review to land at the learner's target recall
 * probability, so across many reviews their observed success rate *should*
 * equal that target. Where it doesn't, the forgetting curve says by how much
 * the stability estimate is off: solving R(t,S) = observed and R(t,S') =
 * target at the same t gives
 *
 *     S'/S = (target^(1/DECAY) − 1) / (observed^(1/DECAY) − 1)
 *
 * A learner recalling 95% where 90% was asked has stronger memory than
 * modelled and can take longer intervals; one recalling 85% needs shorter.
 *
 * Deliberately conservative: nothing below MIN_REVIEWS_TO_CALIBRATE reviews,
 * shrunk toward 1.0 by sample size, and clamped. The correction applies to
 * the *interval*, never to the stored stability — so recalibrating later
 * changes future scheduling without having corrupted card state.
 *
 * @param observedRetention 0..1, measured (see computeSRSRetentionRate).
 * @param targetRetention   0..1, what the learner asked for; default 0.9.
 * @param reviewCount       Successful reviews the measurement rests on.
 */
export function calibrationMultiplier(
  observedRetention: number | undefined,
  targetRetention: number | undefined,
  reviewCount: number,
): number {
  if (!Number.isFinite(reviewCount) || reviewCount < MIN_REVIEWS_TO_CALIBRATE) return 1;
  if (observedRetention == null || !Number.isFinite(observedRetention)) return 1;

  // Outside this range the curve's answer stops being meaningful: at 1.0 the
  // denominator is zero, and very low rates imply a schedule so wrong that a
  // multiplier is the wrong remedy.
  const observed = Math.min(0.98, Math.max(0.5, observedRetention));
  const target = Math.min(0.97, Math.max(0.7, targetRetention ?? 0.9));

  const raw =
    (Math.pow(target, 1 / DECAY) - 1) / (Math.pow(observed, 1 / DECAY) - 1);
  if (!Number.isFinite(raw) || raw <= 0) return 1;

  const weight = reviewCount / (reviewCount + CALIBRATION_SHRINKAGE);
  const shrunk = 1 + (raw - 1) * weight;
  return Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, shrunk));
}

/** Deterministic hash → [-1, 1), stable across sessions. */
function fuzzUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map the 32-bit hash onto [-1, 1).
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/**
 * ±5% load-balancing fuzz for day-scale intervals. Sub-3-day intervals are
 * left exact — learning steps are meant to be precise — and the result never
 * drops below 2 days so fuzz can't demote a graduated card back to tomorrow.
 */
export function fuzzInterval(intervalDays: number, seed: string | undefined): number {
  if (!seed || intervalDays < 3) return intervalDays;
  const delta = Math.round(intervalDays * 0.05 * fuzzUnit(`${seed}:${intervalDays}`));
  return Math.max(2, intervalDays + delta);
}

/** Guard the caller's value, so a bad stored number cannot wreck a schedule. */
function clampCalibration(multiplier: number | undefined): number {
  if (multiplier == null || !Number.isFinite(multiplier)) return 1;
  return Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, multiplier));
}

// ── Rating → integer (FSRS uses 1-4) ─────────────────────────────────────────
const RATING_NUM: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

// ── Core formulas ─────────────────────────────────────────────────────────────

/** Probability of recall after `elapsed` days given stability `s`. */
function retrievability(elapsed: number, s: number): number {
  return Math.pow(1 + FACTOR * Math.max(elapsed, 0) / s, DECAY);
}

/** Initial stability for a brand-new card. */
function initStability(r: number): number {
  return clampS(W[r - 1]);
}

/** Initial difficulty (1–10) for a brand-new card. */
function initDifficulty(r: number): number {
  return clampD(W[4] - Math.exp(W[5] * (r - 1)) + 1);
}

function clampD(d: number): number {
  return Math.min(10, Math.max(1, d));
}

function clampS(s: number): number {
  return Math.min(MAX_STABILITY, Math.max(MIN_STABILITY, s));
}

/**
 * Next difficulty after a review. FSRS-5: the delta is linearly damped as
 * difficulty approaches 10 (so a hard card can't saturate in a handful of
 * lapses), then mean-reverted toward the "Easy" baseline D₀(4) so difficulty
 * can't drift and stick at an extreme.
 */
function nextDifficulty(d: number, r: number): number {
  const delta = -W[6] * (r - 3);
  const damped = d + delta * ((10 - d) / 9);
  return clampD(W[7] * initDifficulty(4) + (1 - W[7]) * damped);
}

/** Stability after a successful recall (Hard/Good/Easy) on a later day. */
function nextRecallStability(d: number, s: number, r: number, rating: number): number {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus   = rating === 4 ? W[16] : 1;
  return s * (
    Math.exp(W[8]) *
    (11 - d) *
    Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus
    + 1
  );
}

/**
 * Stability after forgetting (Again) on a later day. Lower than before but
 * not zero; capped at the pre-lapse stability because a lapse is evidence the
 * estimate was too high, never too low.
 */
function nextForgetStability(d: number, s: number, r: number): number {
  const forget =
    W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - r));
  return Math.min(forget, s);
}

/**
 * Stability after a review on the *same day* as the previous one (FSRS-5).
 *
 * The forgetting-curve formulas above are undefined for this case: minutes
 * after a review, retrievability ≈ 1, the growth term (e^(w10·(1−R)) − 1)
 * is ≈ 0, and every success rating returns S′ ≈ S — identical intervals on
 * Hard, Good and Easy. This dedicated formula keeps the ratings meaningful:
 * with stock weights, Again ≈ ×0.55, Hard ≈ ×0.84, Good ≈ ×1.41, Easy ≈ ×2.36.
 */
function shortTermStability(s: number, rating: number): number {
  return s * Math.exp(W[17] * (rating - 3 + W[18]));
}

// ── Learning steps ────────────────────────────────────────────────────────────
// Anki-style intra-day steps. FSRS best practice is few, short steps (the
// short-term formula models same-day memory itself): a failed or shaky card
// comes back within the session; Good/Easy graduate straight to a day-scale
// interval from S₀.
const LEARNING_STEP_AGAIN = 1 / 1440;  // 1 minute
const LEARNING_STEP_HARD  = 5 / 1440;  // 5 minutes
/** Relearning step after a lapse on a graduated card (Anki default: 10m). */
const RELEARNING_STEP     = 10 / 1440;

// ── Main scheduling function ──────────────────────────────────────────────────

/**
 * Calculate the next review schedule using FSRS-5.
 *
 * @param rating     User's recall rating
 * @param stability  Current stability S (stored in ease_factor column). 0 for new cards.
 * @param difficulty Current difficulty D (stored in difficulty column). 5 for new cards.
 * @param intervalDays  Last scheduled interval in days (fallback elapsed proxy)
 * @param repetitions   Number of completed reviews so far
 * @param elapsedDays   Actual days since the last review (from last_reviewed_at).
 *                      When supplied, FSRS retrievability is measured at the real
 *                      review moment instead of assuming the card was reviewed on
 *                      schedule — so overdue reviews are no longer mis-estimated,
 *                      and a re-review within the same day takes the short-term
 *                      path. Compute it with {@link elapsedDaysSince}.
 */
export function calculateNextReview(
  rating: Rating,
  stability: number,
  difficulty: number,
  intervalDays: number,
  repetitions: number,
  elapsedDays?: number,
  options?: ScheduleOptions,
): ReviewResult {
  const r = RATING_NUM[rating];
  // Retention target and per-learner calibration both scale stability into an
  // interval, so they compose as one factor. Stored stability stays the
  // model's own estimate — see calibrationMultiplier.
  const calibration = clampCalibration(options?.stabilityMultiplier);
  const intervalFactor = retentionFactor(options?.desiredRetention) * calibration;

  // A card has a memory state once any rating has been recorded for it.
  // `repetitions` stays 0 through the learning steps (Again/Hard), so it alone
  // can't tell "brand new" from "failed five minutes ago" — but elapsedDays
  // can: it exists only once last_reviewed_at was written. Without this, a
  // card's Again/Hard history was thrown away and its next Good re-initialised
  // stability as if it had never struggled. Legacy rows carrying the old SM-2
  // column default (ease 2.5, repetitions 0, never reviewed) have no
  // timestamp and correctly land in the first-exposure branch.
  const hasMemoryState = stability > 0 && (repetitions > 0 || elapsedDays != null);

  let newStability: number;
  let newDifficulty: number;
  let newInterval: number;
  let newRepetitions: number;

  if (!hasMemoryState) {
    // ── First exposure ──────────────────────────────────────────────────────
    newStability  = initStability(r);
    newDifficulty = initDifficulty(r);

    if (rating === 'again' || rating === 'hard') {
      newInterval = rating === 'again' ? LEARNING_STEP_AGAIN : LEARNING_STEP_HARD;
      newRepetitions = 0; // still in learning phase
    } else {
      // Good/Easy: graduate to review
      newInterval    = Math.max(rating === 'easy' ? 4 : 1, Math.round(newStability * intervalFactor));
      newRepetitions = 1;
    }
  } else {
    // ── Card with a memory state (learning or graduated) ────────────────────
    const s = clampS(stability);
    const d = difficulty > 0 ? difficulty : 5.0;
    // Prefer real elapsed time (from last_reviewed_at) when the caller supplies
    // it; fall back to the scheduled interval only when it's unknown. A card
    // reviewed on the day it's due gives elapsed ≈ interval (unchanged
    // behaviour); a card reviewed late now correctly lowers retrievability.
    const elapsed = elapsedDays != null
      ? Math.max(elapsedDays, 0)
      : Math.max(intervalDays, 1);
    // FSRS-5's same-day boundary: reviews under a day apart carry short-term
    // memory the forgetting curve can't see.
    const sameDay = elapsed < 1;

    newDifficulty = nextDifficulty(d, r);

    if (sameDay) {
      newStability = clampS(shortTermStability(s, r));
    } else if (rating === 'again') {
      newStability = clampS(nextForgetStability(d, s, retrievability(elapsed, s)));
    } else {
      newStability = clampS(nextRecallStability(d, s, retrievability(elapsed, s), r));
    }

    const stillLearning = repetitions === 0;
    if (rating === 'again') {
      // Forgot — back to an intra-day step. Keep repetitions > 0 so a lapsed
      // graduated card is not re-treated as brand-new.
      newInterval    = stillLearning ? LEARNING_STEP_AGAIN : RELEARNING_STEP;
      newRepetitions = repetitions;
    } else if (rating === 'hard' && stillLearning) {
      // Shaky and never graduated — repeat the learning step.
      newInterval    = LEARNING_STEP_HARD;
      newRepetitions = 0;
    } else {
      // Recalled — the interval is the (updated) stability scaled to the
      // learner's retention target (identical at the 90% default).
      newInterval    = Math.round(newStability * intervalFactor);
      newRepetitions = repetitions + 1;
    }
  }

  // Sub-day intervals keep minute precision; day+ intervals are whole days
  if (newInterval >= 1) {
    newInterval = Math.max(1, Math.round(newInterval));
    newInterval = fuzzInterval(newInterval, options?.fuzzSeed);
  }

  const nextReviewAt = new Date();
  nextReviewAt.setTime(nextReviewAt.getTime() + newInterval * 24 * 60 * 60 * 1000);

  return {
    stability:    Math.round(newStability   * 10000) / 10000,
    difficulty:   Math.round(newDifficulty  * 10000) / 10000,
    intervalDays: newInterval,
    repetitions:  newRepetitions,
    nextReviewAt,
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function getIntervalDisplay(intervalDays: number): string {
  if (intervalDays < 1 / 60) {
    return '< 1m';
  } else if (intervalDays < 1 / 24) {
    const minutes = Math.round(intervalDays * 24 * 60);
    return `${minutes}m`;
  } else if (intervalDays < 1) {
    const hours = Math.round(intervalDays * 24);
    return `${hours}h`;
  } else if (intervalDays < 30) {
    return `${Math.round(intervalDays)}d`;
  } else if (intervalDays < 365) {
    return `${Math.round(intervalDays / 30)}mo`;
  } else {
    return `${Math.round(intervalDays / 365 * 10) / 10}y`;
  }
}

export function estimateNextInterval(
  rating: Rating,
  stability: number,
  difficulty: number,
  intervalDays: number,
  repetitions: number,
  elapsedDays?: number,
  options?: ScheduleOptions,
): string {
  const result = calculateNextReview(rating, stability, difficulty, intervalDays, repetitions, elapsedDays, options);
  return getIntervalDisplay(result.intervalDays);
}

/**
 * Days elapsed since an ISO timestamp, for feeding real elapsed time into
 * {@link calculateNextReview}. Returns undefined when no usable timestamp is
 * available (e.g. a never-reviewed card), so the scheduler falls back to the
 * scheduled interval.
 */
export function elapsedDaysSince(lastReviewedAt: string | null | undefined): number | undefined {
  if (!lastReviewedAt) return undefined;
  const then = new Date(lastReviewedAt).getTime();
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, (Date.now() - then) / (24 * 60 * 60 * 1000));
}
