/**
 * FSRS-6 Spaced Repetition Algorithm
 *
 * Free Spaced Repetition Scheduler v6 — the current release of the algorithm
 * Anki ships. On the maintainers' benchmark (9,999 collections, 350M reviews)
 * it beats FSRS-5 on every metric (log loss 0.3460 vs 0.3561), and the gap to
 * the next version is smaller than the gap between stock and per-learner
 * weights — which is why this module takes a `weights` option and why
 * review_log exists (docs/language-learning-research-2026-09.md §1).
 *
 * Key ideas:
 *   - Uses stability (S) instead of an ease factor: S = days until 90% retention
 *   - Uses difficulty (D, 1–10) to modulate stability growth
 *   - Forgetting curve: R(t,S) = (1 + factor × t/S)^(−w20). FSRS-6's one
 *     structural change: the curve's flatness is a *trained* parameter, so a
 *     learner whose memories fade steeply and one whose fade slowly get
 *     different curves rather than the same shape rescaled.
 *   - Stability after recall grows from current difficulty + retrievability
 *   - Stability after forgetting uses a separate formula, capped below the
 *     pre-lapse stability (forgetting can only ever lower the estimate)
 *   - A review on the *same day* as the last one uses the dedicated
 *     short-term formula S′ = S · e^(w17 · (G − 3 + w18)) · S^(−w19) — the
 *     S^(−w19) term is FSRS-6's revision, so a small stability grows faster
 *     and a large one slower. Without a same-day formula at all (FSRS-4.5),
 *     a re-rated card has retrievability ≈ 1, the growth term collapses to
 *     zero, and Hard/Good/Easy all produce the *identical* interval — the
 *     "every button says 13d" bug. FSRS-6 also floors a same-day success at
 *     ×1: Hard minutes after Good no longer *shrinks* the estimate.
 *
 * State stored per card:
 *   ease_factor  → stability S (days to 90% retention)
 *   difficulty   → difficulty D (1–10)
 *   interval_days → last scheduled interval (rounded stability)
 *   repetitions  → number of completed (graduated) reviews
 *
 * Reference: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
 * and fsrs-rs src/model.rs, which the formulas below follow line for line.
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

// ── FSRS-6 default parameters ─────────────────────────────────────────────────
// The stock 21-weight set (fsrs-rs DEFAULT_PARAMETERS), trained on ~10k Anki
// collections. Per-learner weights fitted from review_log replace these
// through ScheduleOptions.weights; these are what everyone starts on.
export const FSRS6_DEFAULT_WEIGHTS: readonly number[] = Object.freeze([
  0.212,   // w0:  S₀ for Again
  1.2931,  // w1:  S₀ for Hard
  2.3065,  // w2:  S₀ for Good
  8.2956,  // w3:  S₀ for Easy
  6.4133,  // w4:  D₀ base
  0.8334,  // w5:  D₀ exponent
  3.0194,  // w6:  difficulty delta weight
  0.001,   // w7:  difficulty mean-reversion weight
  1.8722,  // w8:  recall stability: base exponent
  0.1666,  // w9:  recall stability: S^(-w9)
  0.796,   // w10: recall stability: R factor
  1.4835,  // w11: forget stability: multiplier
  0.0614,  // w12: forget stability: D^(-w12)
  0.2629,  // w13: forget stability: (S+1)^w13
  1.6483,  // w14: forget stability: R factor
  0.6014,  // w15: Hard penalty
  1.8729,  // w16: Easy bonus
  0.5425,  // w17: short-term (same-day) stability: rating weight
  0.0912,  // w18: short-term (same-day) stability: rating offset
  0.0658,  // w19: short-term (same-day) stability: S^(-w19)
  0.1542,  // w20: forgetting-curve decay (the curve's flatness)
]);

export const WEIGHT_COUNT = 21;
export const FSRS_VERSION = 6;

/**
 * A usable weight vector, or the defaults. A stored vector of the wrong
 * length or with a non-finite entry is ignored whole rather than patched —
 * a half-trusted parameter set schedules worse than none.
 */
export function resolveWeights(weights: readonly number[] | null | undefined): readonly number[] {
  if (!weights || weights.length !== WEIGHT_COUNT) return FSRS6_DEFAULT_WEIGHTS;
  for (const w of weights) if (!Number.isFinite(w)) return FSRS6_DEFAULT_WEIGHTS;
  if (!(weights[20] > 0)) return FSRS6_DEFAULT_WEIGHTS;
  return weights;
}

/** The curve's exponent for a weight set: negative, −w20. */
export function decayOf(w: readonly number[]): number {
  return -w[20];
}

/** The curve's scale for a weight set, chosen so that R(S, S) = 0.9. */
export function factorOf(w: readonly number[]): number {
  return Math.exp(Math.log(0.9) / decayOf(w)) - 1;
}

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
  /**
   * This learner's fitted FSRS-6 weights (21 numbers), from
   * profiles.fsrs_weights. Absent or unusable = the stock defaults. Fitting
   * beats the version bump: FSRS-7 on stock weights scores worse than
   * per-learner FSRS-5 on the maintainers' benchmark.
   */
  weights?: readonly number[] | null;
}

/** Interval multiplier for a desired retention; 1.0 at the 90% default. */
export function retentionFactor(desiredRetention: number | undefined, weights?: readonly number[] | null): number {
  const w = resolveWeights(weights);
  const r = Math.min(0.97, Math.max(0.7, desiredRetention ?? 0.9));
  return (Math.pow(r, 1 / decayOf(w)) - 1) / factorOf(w);
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
 * for everyone until a learner has enough review_log history to fit their
 * own (ScheduleOptions.weights). Until then, one number — is this learner's
 * memory stronger or weaker than the defaults assume? — is recoverable from
 * state already stored, and it is the cold-start path.
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
  weights?: readonly number[] | null,
): number {
  const decay = decayOf(resolveWeights(weights));
  if (!Number.isFinite(reviewCount) || reviewCount < MIN_REVIEWS_TO_CALIBRATE) return 1;
  if (observedRetention == null || !Number.isFinite(observedRetention)) return 1;

  // Outside this range the curve's answer stops being meaningful: at 1.0 the
  // denominator is zero, and very low rates imply a schedule so wrong that a
  // multiplier is the wrong remedy.
  const observed = Math.min(0.98, Math.max(0.5, observedRetention));
  const target = Math.min(0.97, Math.max(0.7, targetRetention ?? 0.9));

  const raw =
    (Math.pow(target, 1 / decay) - 1) / (Math.pow(observed, 1 / decay) - 1);
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
export function retrievability(elapsed: number, s: number, w: readonly number[] = FSRS6_DEFAULT_WEIGHTS): number {
  return Math.pow(1 + factorOf(w) * Math.max(elapsed, 0) / s, decayOf(w));
}

/** Initial stability for a brand-new card. */
function initStability(w: readonly number[], r: number): number {
  return clampS(w[r - 1]);
}

/** Initial difficulty (1–10) for a brand-new card. */
function initDifficulty(w: readonly number[], r: number): number {
  return clampD(w[4] - Math.exp(w[5] * (r - 1)) + 1);
}

function clampD(d: number): number {
  return Math.min(10, Math.max(1, d));
}

function clampS(s: number): number {
  return Math.min(MAX_STABILITY, Math.max(MIN_STABILITY, s));
}

/**
 * Next difficulty after a review: the delta is linearly damped as difficulty
 * approaches 10 (so a hard card can't saturate in a handful of lapses), then
 * mean-reverted toward the "Easy" baseline D₀(4) so difficulty can't drift
 * and stick at an extreme.
 */
function nextDifficulty(w: readonly number[], d: number, r: number): number {
  const delta = -w[6] * (r - 3);
  const damped = d + delta * ((10 - d) / 9);
  return clampD(w[7] * initDifficulty(w, 4) + (1 - w[7]) * damped);
}

/** Stability after a successful recall (Hard/Good/Easy) on a later day. */
function nextRecallStability(w: readonly number[], d: number, s: number, r: number, rating: number): number {
  const hardPenalty = rating === 2 ? w[15] : 1;
  const easyBonus   = rating === 4 ? w[16] : 1;
  return s * (
    Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus
    + 1
  );
}

/**
 * Stability after forgetting (Again) on a later day. Lower than before but
 * not zero. FSRS-6 caps it at S / e^(w17·w18) — strictly below the pre-lapse
 * stability — because a lapse is evidence the estimate was too high, never
 * too low.
 */
function nextForgetStability(w: readonly number[], d: number, s: number, r: number): number {
  const forget =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - r));
  const cap = s / Math.exp(w[17] * w[18]);
  return Math.min(forget, cap);
}

/**
 * Stability after a review on the *same day* as the previous one.
 *
 * The forgetting-curve formulas above are undefined for this case: minutes
 * after a review, retrievability ≈ 1, the growth term (e^(w10·(1−R)) − 1)
 * is ≈ 0, and every success rating returns S′ ≈ S — identical intervals on
 * Hard, Good and Easy. This dedicated formula keeps the ratings meaningful.
 * FSRS-6's S^(−w19) term grows a small stability faster than a large one,
 * and a success (Hard/Good/Easy) is floored at ×1 — re-rating Hard minutes
 * after Good is not evidence the memory got weaker.
 */
function shortTermStability(w: readonly number[], s: number, rating: number): number {
  const sinc = Math.exp(w[17] * (rating - 3 + w[18])) * Math.pow(s, -w[19]);
  return s * (rating >= 2 ? Math.max(sinc, 1) : sinc);
}

// ── Pure memory-state step (used by the fitter) ───────────────────────────────

export interface MemoryState {
  stability: number;
  difficulty: number;
}

/**
 * The memory state after one review, with no scheduling attached — what a
 * fit replays a card's history with. `state` null means the card's first
 * exposure; `elapsedDays` under 1 takes the same-day path. Mirrors the
 * branches in calculateNextReview exactly; the two must not drift.
 */
export function nextMemoryState(
  w: readonly number[],
  state: MemoryState | null,
  rating: Rating,
  elapsedDays: number,
): MemoryState {
  const r = RATING_NUM[rating];
  if (!state || !(state.stability > 0)) {
    return { stability: initStability(w, r), difficulty: initDifficulty(w, r) };
  }
  const s = clampS(state.stability);
  const d = state.difficulty > 0 ? state.difficulty : 5.0;
  const elapsed = Math.max(elapsedDays, 0);
  const difficulty = nextDifficulty(w, d, r);
  let stability: number;
  if (elapsed < 1) {
    stability = clampS(shortTermStability(w, s, r));
  } else if (rating === 'again') {
    stability = clampS(nextForgetStability(w, d, s, retrievability(elapsed, s, w)));
  } else {
    stability = clampS(nextRecallStability(w, d, s, retrievability(elapsed, s, w), r));
  }
  return { stability, difficulty };
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
 * Calculate the next review schedule using FSRS-6.
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
  const w = resolveWeights(options?.weights);
  // Retention target and per-learner calibration both scale stability into an
  // interval, so they compose as one factor. Stored stability stays the
  // model's own estimate — see calibrationMultiplier.
  const calibration = clampCalibration(options?.stabilityMultiplier);
  const intervalFactor = retentionFactor(options?.desiredRetention, w) * calibration;

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
    newStability  = initStability(w, r);
    newDifficulty = initDifficulty(w, r);

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
    // The same-day boundary (elapsed < 1) is inside nextMemoryState: reviews
    // under a day apart carry short-term memory the forgetting curve can't see.
    const next = nextMemoryState(w, { stability: s, difficulty: d }, rating, elapsed);
    newStability = next.stability;
    newDifficulty = next.difficulty;

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
