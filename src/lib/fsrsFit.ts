/**
 * Fitting FSRS-6 weights to one learner's review history.
 *
 * Pure: no IO, no clock, deterministic. The hook (useFsrsFit) fetches
 * review_log and writes the result; this decides what the result is.
 *
 * Why it exists: on the maintainers' benchmark, per-learner weights are worth
 * more than an algorithm version — FSRS-7 on stock weights scores worse than
 * per-learner FSRS-5 (docs/language-learning-research-2026-09.md §1). The
 * review_log trigger records every rating with the memory state either side
 * of it; this replays those histories under candidate weights and keeps the
 * set that predicts recall best.
 *
 * Two rules protect the learner from a bad fit:
 *   - the gate: a fit is adopted only if it beats the stock weights on a
 *     held-out, most-recent slice of the history it was NOT trained on — the
 *     benchmark's own criterion;
 *   - the bounds: every weight stays inside fsrs-rs's clip range, so descent
 *     cannot wander into a degenerate curve.
 *
 * The optimiser is bounded coordinate descent on log loss. It is not the
 * gradient trainer fsrs-rs uses, but it is deterministic, dependency-free,
 * and fast enough for a learner's history (tens of thousands of reviews) on
 * the main thread. The WASM trainer (fsrs-browser) can replace the descent
 * step later; the gate and the bounds stay.
 */
import {
  FSRS6_DEFAULT_WEIGHTS,
  nextMemoryState,
  retrievability,
  WEIGHT_COUNT,
  type MemoryState,
  type Rating,
} from "./spacedRepetition";

/** The columns of review_log a fit reads. */
export interface ReviewLogRow {
  deck: string;
  card_id: string;
  direction: string;
  rating: string | null;
  reviewed_at: string;
}

export interface HistoryReview {
  rating: Rating;
  /** Days since this card's previous review; 0 on the first. */
  elapsedDays: number;
  /** Epoch ms, for the time-based hold-out. */
  at: number;
}

export interface CardHistory {
  key: string;
  reviews: HistoryReview[];
}

/** Rated reviews below which no fit is attempted. */
export const MIN_REVIEWS_TO_FIT = 1000;
/** Most-recent share of the history held out to judge the fit. */
export const HOLD_OUT_FRACTION = 0.2;
/** Relative log-loss improvement on the held-out slice a fit must show. */
export const MIN_IMPROVEMENT = 0.005;

const RATINGS = new Set<string>(["again", "hard", "good", "easy"]);
const DAY_MS = 86_400_000;

/**
 * Clip range per weight, after fsrs-rs clip_parameters. Conservative on
 * purpose: a weight at a bound is a sign the history is odd, not a licence.
 */
export const PARAMETER_BOUNDS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0.001, 100], [0.001, 100], [0.001, 100], [0.001, 100],   // w0–w3 initial stability
  [1, 10], [0.001, 4],                                       // w4, w5 initial difficulty
  [0.001, 4], [0.001, 0.75],                                 // w6 delta, w7 mean reversion
  [0, 4.5], [0, 0.8], [0.001, 3.5],                          // w8–w10 recall stability
  [0.001, 5], [0.001, 0.25], [0.001, 0.9], [0, 4],           // w11–w14 forget stability
  [0, 1], [1, 6],                                            // w15 hard penalty, w16 easy bonus
  [0, 2], [0, 2], [0, 0.8],                                  // w17–w19 short-term
  [0.1, 0.8],                                                // w20 decay
]);

/** Group a learner's log into per-card histories in review order. */
export function buildHistories(rows: ReviewLogRow[]): CardHistory[] {
  const byCard = new Map<string, Array<{ rating: Rating; at: number }>>();
  for (const row of rows) {
    if (!row.rating || !RATINGS.has(row.rating)) continue;
    const at = Date.parse(row.reviewed_at);
    if (!Number.isFinite(at)) continue;
    const key = `${row.deck}:${row.card_id}:${row.direction}`;
    let list = byCard.get(key);
    if (!list) { list = []; byCard.set(key, list); }
    list.push({ rating: row.rating as Rating, at });
  }
  const out: CardHistory[] = [];
  for (const [key, list] of byCard) {
    list.sort((a, b) => a.at - b.at);
    const reviews: HistoryReview[] = list.map((r, i) => ({
      rating: r.rating,
      elapsedDays: i === 0 ? 0 : Math.max(0, (r.at - list[i - 1].at) / DAY_MS),
      at: r.at,
    }));
    out.push({ key, reviews });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/** Rated reviews across all histories. */
export function countReviews(histories: CardHistory[]): number {
  return histories.reduce((n, h) => n + h.reviews.length, 0);
}

export interface LossOptions {
  /** Count only reviews at or after this epoch ms toward the loss. */
  after?: number;
  /** Count only reviews before this epoch ms. */
  before?: number;
}

/**
 * Mean negative log-likelihood of the observed recalls under `w`.
 *
 * Every review after a card's first is a prediction: the state before it
 * gives R for the elapsed time, the rating says whether recall happened.
 * Same-day reviews (elapsed < 1) update the state but are not scored — the
 * forgetting curve is not a model of minutes, and fsrs-rs excludes them too.
 * Returns NaN when nothing was scorable.
 */
export function logLoss(histories: CardHistory[], w: readonly number[], options: LossOptions = {}): number {
  let sum = 0;
  let n = 0;
  const after = options.after ?? Number.NEGATIVE_INFINITY;
  const before = options.before ?? Number.POSITIVE_INFINITY;
  for (const history of histories) {
    let state: MemoryState | null = null;
    for (const review of history.reviews) {
      if (state && review.elapsedDays >= 1 && review.at >= after && review.at < before) {
        const r = Math.min(1 - 1e-6, Math.max(1e-6, retrievability(review.elapsedDays, state.stability, w)));
        const y = review.rating === "again" ? 0 : 1;
        sum += -(y * Math.log(r) + (1 - y) * Math.log(1 - r));
        n += 1;
      }
      state = nextMemoryState(w, state, review.rating, review.elapsedDays);
    }
  }
  return n === 0 ? Number.NaN : sum / n;
}

/**
 * The epoch ms at which the most-recent `fraction` of scorable reviews
 * begins. Reviews before it train; reviews at or after it judge. Time-based
 * rather than per-card so the judge never sees a card's future.
 */
export function holdOutCutoff(histories: CardHistory[], fraction = HOLD_OUT_FRACTION): number {
  const times: number[] = [];
  for (const h of histories) {
    h.reviews.forEach((r, i) => { if (i > 0 && r.elapsedDays >= 1) times.push(r.at); });
  }
  if (times.length === 0) return Number.POSITIVE_INFINITY;
  times.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(times.length - 1, Math.floor(times.length * (1 - fraction))));
  return times[idx];
}

export function clampWeights(w: readonly number[]): number[] {
  return w.map((v, i) => {
    const [lo, hi] = PARAMETER_BOUNDS[i];
    return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : (lo + hi) / 2));
  });
}

export interface FitOptions {
  start?: readonly number[];
  /** Passes over all 21 weights; each pass uses a smaller step. */
  stepFractions?: readonly number[];
  /** Only reviews before this epoch ms train. */
  before?: number;
}

/**
 * Bounded coordinate descent on log loss. For each weight in turn, try a
 * step up and a step down (as a fraction of the weight's range); keep it if
 * the training loss falls. Deterministic; returns the weights and the loss.
 */
export function fitWeights(histories: CardHistory[], options: FitOptions = {}): { weights: number[]; loss: number } {
  const steps = options.stepFractions ?? [0.2, 0.08, 0.03, 0.01];
  const lossOf = (w: readonly number[]) => logLoss(histories, w, { before: options.before });
  let current = clampWeights(options.start ?? FSRS6_DEFAULT_WEIGHTS);
  let best = lossOf(current);
  if (!Number.isFinite(best)) return { weights: current, loss: best };

  for (const fraction of steps) {
    for (let i = 0; i < WEIGHT_COUNT; i++) {
      const [lo, hi] = PARAMETER_BOUNDS[i];
      const step = (hi - lo) * fraction;
      for (const delta of [step, -step]) {
        const candidate = [...current];
        candidate[i] = Math.min(hi, Math.max(lo, current[i] + delta));
        if (candidate[i] === current[i]) continue;
        const loss = lossOf(candidate);
        if (Number.isFinite(loss) && loss < best) {
          current = candidate;
          best = loss;
        }
      }
    }
  }
  return { weights: current, loss: best };
}

export type FitStatus = "too-few" | "kept-defaults" | "fitted";

export interface FitResult {
  status: FitStatus;
  reviews: number;
  /** Held-out log loss of the stock weights, when there was enough to judge. */
  stockLoss?: number;
  /** Held-out log loss of the fitted weights. */
  fittedLoss?: number;
  /** Relative improvement, (stock − fitted) / stock. */
  improvement?: number;
  weights?: number[];
}

/**
 * The whole decision: enough history? Then fit on the older 80%, judge on
 * the newest 20%, and adopt only a fit that beats the stock weights there
 * by MIN_IMPROVEMENT. Anything else keeps the defaults — a wrong fit
 * schedules worse than none.
 */
export function fitFromLog(rows: ReviewLogRow[], options: { minReviews?: number } = {}): FitResult {
  const histories = buildHistories(rows);
  const reviews = countReviews(histories);
  if (reviews < (options.minReviews ?? MIN_REVIEWS_TO_FIT)) return { status: "too-few", reviews };

  const cutoff = holdOutCutoff(histories);
  const stockLoss = logLoss(histories, FSRS6_DEFAULT_WEIGHTS, { after: cutoff });
  if (!Number.isFinite(stockLoss)) return { status: "too-few", reviews };

  const { weights } = fitWeights(histories, { before: cutoff });
  const fittedLoss = logLoss(histories, weights, { after: cutoff });
  const improvement = Number.isFinite(fittedLoss) ? (stockLoss - fittedLoss) / stockLoss : Number.NEGATIVE_INFINITY;

  if (!(improvement >= MIN_IMPROVEMENT)) {
    return { status: "kept-defaults", reviews, stockLoss, fittedLoss, improvement };
  }
  return { status: "fitted", reviews, stockLoss, fittedLoss, improvement, weights };
}
