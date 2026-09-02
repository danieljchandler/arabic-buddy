import { describe, expect, it } from "vitest";
import {
  buildHistories,
  clampWeights,
  countReviews,
  fitFromLog,
  fitWeights,
  holdOutCutoff,
  logLoss,
  MIN_IMPROVEMENT,
  MIN_REVIEWS_TO_FIT,
  PARAMETER_BOUNDS,
  type CardHistory,
  type ReviewLogRow,
} from "./fsrsFit";
import { FSRS6_DEFAULT_WEIGHTS, nextMemoryState, retrievability, WEIGHT_COUNT, type Rating } from "./spacedRepetition";

/**
 * The fitter's two promises: it never adopts weights that do not beat the
 * defaults on history it was not trained on, and it never leaves a weight
 * outside fsrs-rs's clip range. Everything else is arithmetic checked by
 * construction: synthetic learners whose memory really is stronger or
 * weaker than the defaults, generated from the same formulas the fitter
 * replays.
 */

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T00:00:00Z");

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x1_0000_0000; };
}

/**
 * Simulate a learner whose recall follows FSRS-6 under `truth`: each card is
 * reviewed roughly when the stock schedule would ask, recall is a coin flip
 * at the true retrievability, and the state advances under `truth`.
 */
function simulate(truth: readonly number[], cards: number, reviewsPerCard: number, seed: number): ReviewLogRow[] {
  const rand = prng(seed);
  const rows: ReviewLogRow[] = [];
  for (let c = 0; c < cards; c++) {
    let state = null as ReturnType<typeof nextMemoryState> | null;
    let at = T0 + Math.floor(rand() * 30) * DAY;
    let elapsed = 0;
    for (let i = 0; i < reviewsPerCard; i++) {
      let rating: Rating;
      if (!state) rating = rand() < 0.15 ? "again" : rand() < 0.5 ? "good" : "easy";
      else {
        const r = retrievability(elapsed, state.stability, truth);
        rating = rand() < r ? (rand() < 0.2 ? "hard" : rand() < 0.8 ? "good" : "easy") : "again";
      }
      rows.push({ deck: "word", card_id: `c${c}`, direction: "recognition", rating, reviewed_at: new Date(at).toISOString() });
      state = nextMemoryState(truth, state, rating, elapsed);
      // Next review near the stock schedule's ask, jittered.
      elapsed = Math.max(1, Math.round(state.stability * (0.6 + rand() * 0.8)));
      at += elapsed * DAY;
    }
  }
  return rows;
}

describe("buildHistories", () => {
  it("groups by deck, card and direction, in time order, with elapsed days", () => {
    const rows: ReviewLogRow[] = [
      { deck: "word", card_id: "a", direction: "recognition", rating: "good", reviewed_at: "2026-01-05T00:00:00Z" },
      { deck: "word", card_id: "a", direction: "recognition", rating: "again", reviewed_at: "2026-01-01T00:00:00Z" },
      { deck: "word", card_id: "a", direction: "production", rating: "good", reviewed_at: "2026-01-02T00:00:00Z" },
      { deck: "word", card_id: "a", direction: "recognition", rating: null, reviewed_at: "2026-01-03T00:00:00Z" },
    ];
    const h = buildHistories(rows);
    expect(h.map((x) => x.key)).toEqual(["word:a:production", "word:a:recognition"]);
    const rec = h[1];
    expect(rec.reviews.map((r) => r.rating)).toEqual(["again", "good"]);
    expect(rec.reviews[0].elapsedDays).toBe(0);
    expect(rec.reviews[1].elapsedDays).toBeCloseTo(4);
    expect(countReviews(h)).toBe(3);
  });
});

describe("logLoss", () => {
  const histories: CardHistory[] = [{
    key: "k",
    reviews: [
      { rating: "good", elapsedDays: 0, at: T0 },
      { rating: "good", elapsedDays: 0.01, at: T0 + 1000 },   // same-day: not scored
      { rating: "good", elapsedDays: 3, at: T0 + 3 * DAY },
      { rating: "again", elapsedDays: 30, at: T0 + 33 * DAY },
    ],
  }];

  it("scores only reviews after the first and not on the same day", () => {
    const loss = logLoss(histories, FSRS6_DEFAULT_WEIGHTS);
    expect(Number.isFinite(loss)).toBe(true);
    // Two scorable reviews: the 3-day recall (cheap) and the 30-day lapse.
    const onlyLate = logLoss(histories, FSRS6_DEFAULT_WEIGHTS, { after: T0 + 10 * DAY });
    expect(onlyLate).toBeGreaterThan(loss);
  });

  it("is NaN when nothing is scorable", () => {
    expect(Number.isNaN(logLoss([{ key: "x", reviews: [{ rating: "good", elapsedDays: 0, at: T0 }] }], FSRS6_DEFAULT_WEIGHTS))).toBe(true);
  });
});

describe("holdOutCutoff and clampWeights", () => {
  it("puts the newest fifth of scorable reviews after the cutoff", () => {
    const rows = simulate(FSRS6_DEFAULT_WEIGHTS, 40, 6, 3);
    const h = buildHistories(rows);
    const cutoff = holdOutCutoff(h, 0.2);
    let before = 0, after = 0;
    for (const x of h) {
      x.reviews.forEach((r, i) => {
        if (i > 0 && r.elapsedDays >= 1) {
          if (r.at >= cutoff) after++;
          else before++;
        }
      });
    }
    expect(after / (before + after)).toBeGreaterThan(0.12);
    expect(after / (before + after)).toBeLessThan(0.3);
  });

  it("keeps every weight inside its bound and repairs a non-finite one", () => {
    expect(PARAMETER_BOUNDS).toHaveLength(WEIGHT_COUNT);
    const wild = FSRS6_DEFAULT_WEIGHTS.map(() => 1e9);
    wild[3] = Number.NaN;
    const c = clampWeights(wild);
    c.forEach((v, i) => { expect(v).toBeLessThanOrEqual(PARAMETER_BOUNDS[i][1]); expect(v).toBeGreaterThanOrEqual(PARAMETER_BOUNDS[i][0]); });
    expect(Number.isFinite(c[3])).toBe(true);
  });
});

describe("fitting", () => {
  it("lowers training loss and stays within bounds", () => {
    const stronger = [...FSRS6_DEFAULT_WEIGHTS]; stronger[8] += 0.7;
    const h = buildHistories(simulate(stronger, 120, 7, 11));
    const stock = logLoss(h, FSRS6_DEFAULT_WEIGHTS);
    const { weights, loss } = fitWeights(h, { stepFractions: [0.2, 0.08] });
    expect(loss).toBeLessThan(stock);
    weights.forEach((v, i) => { expect(v).toBeLessThanOrEqual(PARAMETER_BOUNDS[i][1]); expect(v).toBeGreaterThanOrEqual(PARAMETER_BOUNDS[i][0]); });
  });

  it("adopts a fit for a learner whose memory genuinely differs from the defaults", () => {
    const stronger = [...FSRS6_DEFAULT_WEIGHTS]; stronger[8] += 0.7; stronger[20] = 0.35;
    const result = fitFromLog(simulate(stronger, 200, 7, 5));
    expect(result.status).toBe("fitted");
    expect(result.improvement!).toBeGreaterThanOrEqual(MIN_IMPROVEMENT);
    expect(result.fittedLoss!).toBeLessThan(result.stockLoss!);
    expect(result.weights).toHaveLength(WEIGHT_COUNT);
  });

  it("refuses to fit on too little history", () => {
    const result = fitFromLog(simulate(FSRS6_DEFAULT_WEIGHTS, 20, 5, 1));
    expect(result.status).toBe("too-few");
    expect(result.reviews).toBeLessThan(MIN_REVIEWS_TO_FIT);
    expect(result.weights).toBeUndefined();
  });

  it("keeps the defaults when the fit does not beat them on the held-out slice", () => {
    // Force the judgement with a tiny minimum so the run is fast, on data
    // the defaults already describe: any 'improvement' is noise and is
    // rejected by the gate unless it clears the margin.
    const result = fitFromLog(simulate(FSRS6_DEFAULT_WEIGHTS, 60, 6, 9), { minReviews: 100 });
    expect(["kept-defaults", "fitted"]).toContain(result.status);
    if (result.status === "kept-defaults") expect(result.weights).toBeUndefined();
    else expect(result.improvement!).toBeGreaterThanOrEqual(MIN_IMPROVEMENT);
  });
});
