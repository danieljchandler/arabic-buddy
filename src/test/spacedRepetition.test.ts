import { describe, it, expect } from "vitest";
import {
  calculateNextReview,
  calibrationMultiplier,
  getIntervalDisplay,
  estimateNextInterval,
  elapsedDaysSince,
  MIN_REVIEWS_TO_CALIBRATE,
  FSRS6_DEFAULT_WEIGHTS,
  WEIGHT_COUNT,
  resolveWeights,
  retrievability,
  decayOf,
} from "@/lib/spacedRepetition";
import type { Rating } from "@/lib/spacedRepetition";

describe("FSRS-6 spacedRepetition", () => {
  describe("calculateNextReview - new cards", () => {
    it("returns short interval for 'again' on new card", () => {
      const result = calculateNextReview("again", 0, 5, 0, 0);
      expect(result.intervalDays).toBeLessThan(1);
      expect(result.repetitions).toBe(0); // still in learning
      expect(result.stability).toBeGreaterThan(0);
    });

    it("graduates to review on 'good' for new card", () => {
      const result = calculateNextReview("good", 0, 5, 0, 0);
      expect(result.intervalDays).toBeGreaterThanOrEqual(1);
      expect(result.repetitions).toBe(1);
    });

    it("assigns higher initial stability for 'easy'", () => {
      const good = calculateNextReview("good", 0, 5, 0, 0);
      const easy = calculateNextReview("easy", 0, 5, 0, 0);
      expect(easy.stability).toBeGreaterThan(good.stability);
      expect(easy.intervalDays).toBeGreaterThanOrEqual(4);
    });
  });

  describe("calculateNextReview - established cards", () => {
    it("increases stability on 'good' review", () => {
      const result = calculateNextReview("good", 5, 5, 5, 3);
      expect(result.stability).toBeGreaterThan(5);
      expect(result.intervalDays).toBeGreaterThan(5);
    });

    it("resets interval on 'again' for established card", () => {
      const result = calculateNextReview("again", 10, 5, 10, 5);
      expect(result.intervalDays).toBeLessThan(1);
      // Repetitions preserved (not reset to 0)
      expect(result.repetitions).toBe(5);
    });

    it("hard gives shorter interval than good", () => {
      const hard = calculateNextReview("hard", 10, 5, 10, 5);
      const good = calculateNextReview("good", 10, 5, 10, 5);
      expect(hard.stability).toBeLessThan(good.stability);
    });
  });

  describe("same-day re-reviews (short-term memory)", () => {
    // The regression this guards: a card re-rated minutes after its last
    // review (relearn queue, lesson quiz, impatient learner) had
    // retrievability ≈ 1, so the FSRS-4.5 growth term collapsed to zero and
    // Hard, Good and Easy all produced the *identical* interval — the
    // "every button says 13d" bug. The short-term formula keeps the ratings
    // meaningful.
    const MINUTES_AGO = 5 / 1440;

    it("keeps the ratings ordered minutes after a review: hard ≤ good < easy, again below all", () => {
      // FSRS-6 floors a same-day *success* at ×1, so on a mature card Hard
      // and Good can tie (neither is evidence the memory changed); Easy still
      // grows it and Again still shrinks it. What must never come back is the
      // FSRS-4.5 collapse where all three successes and the failure were one
      // number.
      const again = calculateNextReview("again", 15, 5, 15, 1, MINUTES_AGO);
      const hard = calculateNextReview("hard", 15, 5, 15, 1, MINUTES_AGO);
      const good = calculateNextReview("good", 15, 5, 15, 1, MINUTES_AGO);
      const easy = calculateNextReview("easy", 15, 5, 15, 1, MINUTES_AGO);
      expect(again.stability).toBeLessThan(hard.stability);
      expect(hard.stability).toBeLessThanOrEqual(good.stability);
      expect(good.stability).toBeLessThan(easy.stability);
      expect(good.intervalDays).toBeLessThan(easy.intervalDays);
    });

    it("never shrinks stability on a same-day success, and grows it on easy", () => {
      // FSRS-6 floors a same-day Hard/Good/Easy at ×1: re-rating Hard minutes
      // after Good is not evidence the memory got weaker. (FSRS-5 shrank it.)
      const hard = calculateNextReview("hard", 15, 5, 15, 1, MINUTES_AGO);
      const easy = calculateNextReview("easy", 15, 5, 15, 1, MINUTES_AGO);
      expect(hard.stability).toBeGreaterThanOrEqual(15);
      expect(easy.stability).toBeGreaterThan(15);
    });

    it("still shrinks stability on a same-day again", () => {
      const again = calculateNextReview("again", 15, 5, 15, 1, MINUTES_AGO);
      expect(again.stability).toBeLessThan(15);
    });

    it("grows a small stability proportionally more than a large one (the S^-w19 term)", () => {
      const small = calculateNextReview("good", 2, 5, 2, 1, MINUTES_AGO);
      const large = calculateNextReview("good", 60, 5, 60, 1, MINUTES_AGO);
      expect(small.stability / 2).toBeGreaterThan(large.stability / 60);
    });

    it("grows stability far less same-day than across a full interval", () => {
      // A second Good minutes later is weak evidence; a Good after the full
      // interval elapsed is strong evidence. The schedule must reflect that.
      const sameDay = calculateNextReview("good", 10, 5, 10, 3, MINUTES_AGO);
      const onSchedule = calculateNextReview("good", 10, 5, 10, 3, 10);
      expect(sameDay.stability).toBeLessThan(onSchedule.stability);
    });

    it("uses the relearning step for a same-day 'again' on a graduated card", () => {
      const result = calculateNextReview("again", 10, 5, 10, 3, MINUTES_AGO);
      expect(result.intervalDays).toBeLessThan(1);
      expect(result.stability).toBeLessThan(10);
      expect(result.repetitions).toBe(3);
    });
  });

  describe("learning-phase memory state", () => {
    it("keeps the state from a failed first rating instead of re-initialising", () => {
      // New card rated Again (1-minute step), then Good when it comes back.
      // The old code saw repetitions === 0 and re-initialised stability as if
      // the card had never been seen — a first-sight Good and a
      // failed-then-recovered card got the same 3-day interval.
      const failed = calculateNextReview("again", 0, 5, 0, 0);
      const recovered = calculateNextReview(
        "good", failed.stability, failed.difficulty, failed.intervalDays, failed.repetitions, 2 / 1440,
      );
      const freshGood = calculateNextReview("good", 0, 5, 0, 0);
      expect(recovered.stability).toBeLessThan(freshGood.stability);
      expect(recovered.repetitions).toBe(1); // graduates, but from its own state
    });

    it("repeats the learning step on 'hard' without graduating", () => {
      const first = calculateNextReview("hard", 0, 5, 0, 0);
      const second = calculateNextReview(
        "hard", first.stability, first.difficulty, first.intervalDays, first.repetitions, 5 / 1440,
      );
      expect(second.intervalDays).toBeLessThan(1);
      expect(second.repetitions).toBe(0);
    });

    it("treats a legacy default row (ease 2.5, never reviewed) as a new card", () => {
      // Pre-FSRS rows carry the SM-2 column default with no last_reviewed_at;
      // elapsedDays is therefore undefined and the row must schedule exactly
      // like a first exposure, not as an established 2.5-day card.
      const legacy = calculateNextReview("good", 2.5, 5, 0, 0);
      const fresh = calculateNextReview("good", 0, 5, 0, 0);
      expect(legacy.stability).toBeCloseTo(fresh.stability, 4);
      expect(legacy.intervalDays).toBe(fresh.intervalDays);
    });
  });

  describe("lapses", () => {
    it("never raises stability on 'again', however overdue the review", () => {
      // The raw forget formula can exceed the current stability for a card
      // with low S reviewed very late; FSRS-5 caps it at the pre-lapse value.
      const result = calculateNextReview("again", 0.5, 5, 1, 3, 30);
      expect(result.stability).toBeLessThanOrEqual(0.5);
    });
  });

  describe("getIntervalDisplay", () => {
    it("formats minutes correctly", () => {
      // 1/60 day = 1 minute threshold; values below show "< 1m"
      expect(getIntervalDisplay(1 / 1440)).toBe("< 1m");
      // 5/60 days ≈ 2 hours — but < 1/24 day threshold is 1h
      expect(getIntervalDisplay(2 / 1440)).toBe("< 1m");
      // 30 minutes = 30/1440 ≈ 0.021 — above 1/60 (0.0167) so shows minutes
      expect(getIntervalDisplay(30 / 1440)).toBe("30m");
    });

    it("formats days correctly", () => {
      expect(getIntervalDisplay(1)).toBe("1d");
      expect(getIntervalDisplay(7)).toBe("7d");
    });

    it("formats months correctly", () => {
      expect(getIntervalDisplay(60)).toBe("2mo");
    });
  });

  describe("estimateNextInterval", () => {
    it("returns a string for any rating", () => {
      const ratings: Rating[] = ["again", "hard", "good", "easy"];
      for (const r of ratings) {
        const display = estimateNextInterval(r, 5, 5, 5, 3);
        expect(typeof display).toBe("string");
        expect(display.length).toBeGreaterThan(0);
      }
    });
  });

  describe("difficulty persistence", () => {
    // The regression this guards: difficulty used to be a constant 5.0 at every
    // call site, so the FSRS difficulty term never moved. It must now respond to
    // the rating and accumulate when fed back in.
    it("returns a difficulty in the valid 1–10 range", () => {
      const result = calculateNextReview("good", 5, 5, 5, 3);
      expect(result.difficulty).toBeGreaterThanOrEqual(1);
      expect(result.difficulty).toBeLessThanOrEqual(10);
    });

    it("raises difficulty on 'again' and lowers it on 'easy' from the same state", () => {
      const again = calculateNextReview("again", 5, 5, 5, 3);
      const easy = calculateNextReview("easy", 5, 5, 5, 3);
      expect(again.difficulty).toBeGreaterThan(easy.difficulty);
    });

    it("accumulates difficulty across repeated hard reviews when fed back in", () => {
      // Simulate a genuinely hard card reviewed several times, threading the
      // returned difficulty back in (what the fixed call sites now persist).
      let difficulty = 5;
      let stability = 5;
      let repetitions = 3;
      const first = difficulty;
      for (let i = 0; i < 4; i++) {
        const r = calculateNextReview("hard", stability, difficulty, Math.round(stability), repetitions);
        difficulty = r.difficulty;
        stability = r.stability;
        repetitions = r.repetitions;
      }
      // Had difficulty stayed pinned at 5.0 (the old bug), this would be unchanged.
      expect(difficulty).toBeGreaterThan(first);
    });
  });

  describe("real elapsed time", () => {
    // The regression this guards: elapsed time used to be faked as the scheduled
    // interval, so an overdue review was scheduled identically to an on-time one.
    it("grows stability less when a recall happens overdue than on schedule", () => {
      const stability = 10;
      const interval = 10;
      const onSchedule = calculateNextReview("good", stability, 5, interval, 5, interval);
      const overdue = calculateNextReview("good", stability, 5, interval, 5, interval * 5);
      // Lower retrievability at review time (overdue) yields a larger stability
      // increase in FSRS — the key is that the two are no longer identical.
      expect(overdue.stability).not.toBeCloseTo(onSchedule.stability, 5);
    });

    it("falls back to the scheduled interval when elapsedDays is omitted", () => {
      const withProxy = calculateNextReview("good", 10, 5, 10, 5);
      const withExplicit = calculateNextReview("good", 10, 5, 10, 5, 10);
      expect(withProxy.stability).toBeCloseTo(withExplicit.stability, 5);
    });
  });

  describe("elapsedDaysSince", () => {
    it("returns undefined for null/empty/invalid input", () => {
      expect(elapsedDaysSince(null)).toBeUndefined();
      expect(elapsedDaysSince(undefined)).toBeUndefined();
      expect(elapsedDaysSince("not-a-date")).toBeUndefined();
    });

    it("returns roughly the number of days since the timestamp", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const elapsed = elapsedDaysSince(threeDaysAgo);
      expect(elapsed).toBeGreaterThan(2.9);
      expect(elapsed).toBeLessThan(3.1);
    });

    it("never returns a negative value for a future timestamp", () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      expect(elapsedDaysSince(future)).toBe(0);
    });
  });

  describe("FSRS-6 weights", () => {
    it("ships the stock 21-weight set", () => {
      expect(FSRS6_DEFAULT_WEIGHTS).toHaveLength(WEIGHT_COUNT);
      expect(FSRS6_DEFAULT_WEIGHTS[20]).toBeCloseTo(0.1542, 4);
    });

    it("keeps R(S, S) = 0.9 for any decay — the curve is rescaled, not redefined", () => {
      for (const w20 of [0.05, 0.1542, 0.5, 0.9]) {
        const w = [...FSRS6_DEFAULT_WEIGHTS]; w[20] = w20;
        expect(retrievability(10, 10, w)).toBeCloseTo(0.9, 6);
      }
      expect(decayOf(FSRS6_DEFAULT_WEIGHTS)).toBeLessThan(0);
    });

    it("ignores a weight vector of the wrong length or with a bad entry, whole", () => {
      expect(resolveWeights(null)).toBe(FSRS6_DEFAULT_WEIGHTS);
      expect(resolveWeights([1, 2, 3])).toBe(FSRS6_DEFAULT_WEIGHTS);
      const nan = [...FSRS6_DEFAULT_WEIGHTS]; nan[8] = Number.NaN;
      expect(resolveWeights(nan)).toBe(FSRS6_DEFAULT_WEIGHTS);
      const zeroDecay = [...FSRS6_DEFAULT_WEIGHTS]; zeroDecay[20] = 0;
      expect(resolveWeights(zeroDecay)).toBe(FSRS6_DEFAULT_WEIGHTS);
      const fine = [...FSRS6_DEFAULT_WEIGHTS];
      expect(resolveWeights(fine)).toBe(fine);
    });

    it("schedules differently on a learner's own weights", () => {
      const stock = calculateNextReview("good", 40, 5, 40, 6, 40);
      const strongerMemory = [...FSRS6_DEFAULT_WEIGHTS]; strongerMemory[8] += 0.5;
      const fitted = calculateNextReview("good", 40, 5, 40, 6, 40, { weights: strongerMemory });
      expect(fitted.stability).toBeGreaterThan(stock.stability);
      expect(fitted.intervalDays).toBeGreaterThan(stock.intervalDays);
    });

    it("caps post-lapse stability strictly below the pre-lapse value", () => {
      const w = FSRS6_DEFAULT_WEIGHTS;
      const cap = 50 / Math.exp(w[17] * w[18]);
      // An absurdly overdue lapse would otherwise compute a large S′.
      const lapse = calculateNextReview("again", 50, 1, 50, 8, 1000);
      expect(lapse.stability).toBeLessThanOrEqual(cap + 1e-4);
      expect(lapse.stability).toBeLessThan(50);
    });
  });

  describe("personalisation (C2)", () => {
    // A mature card: high stability so intervals are long enough to measure.
    const MATURE = { stability: 40, difficulty: 5, interval: 40, reps: 6 } as const;

    const schedule = (options?: Parameters<typeof calculateNextReview>[6]) =>
      calculateNextReview("good", MATURE.stability, MATURE.difficulty, MATURE.interval, MATURE.reps, 40, options);

    it("changes nothing at the default 90% target with no fuzz seed", () => {
      // The dial and the fuzz are strictly additive: a caller that passes no
      // options gets the exact historical schedule.
      expect(schedule().intervalDays).toBe(schedule({ desiredRetention: 0.9 }).intervalDays);
    });

    it("stretches intervals when the learner accepts more forgetting", () => {
      const standard = schedule({ desiredRetention: 0.9 }).intervalDays;
      const lighter = schedule({ desiredRetention: 0.85 }).intervalDays;
      const intense = schedule({ desiredRetention: 0.95 }).intervalDays;
      expect(lighter).toBeGreaterThan(standard);
      expect(intense).toBeLessThan(standard);
    });

    it("does not change the memory model, only the schedule", () => {
      // Stability is what the learner's memory is estimated to be; the dial
      // must never rewrite that estimate, or switching back would corrupt
      // every card it touched.
      expect(schedule({ desiredRetention: 0.8 }).stability).toBe(schedule().stability);
    });

    it("clamps an absurd retention target", () => {
      const floor = schedule({ desiredRetention: 0.1 }).intervalDays;
      expect(floor).toBe(schedule({ desiredRetention: 0.7 }).intervalDays);
    });

    it("fuzzes deterministically: same card, same interval, same answer", () => {
      const a = schedule({ fuzzSeed: "card-1" }).intervalDays;
      const b = schedule({ fuzzSeed: "card-1" }).intervalDays;
      expect(a).toBe(b);
    });

    it("spreads different cards apart", () => {
      // Not every pair of seeds lands apart (5% of a short interval rounds to
      // zero for some hashes), but across many cards the spread must be real —
      // that is the whole point of load balancing.
      const intervals = new Set(
        Array.from({ length: 30 }, (_, i) => schedule({ fuzzSeed: `card-${i}` }).intervalDays),
      );
      expect(intervals.size).toBeGreaterThan(1);
    });

    it("keeps fuzz inside ±5% of the base interval", () => {
      const base = schedule().intervalDays;
      for (let i = 0; i < 30; i++) {
        const fuzzed = schedule({ fuzzSeed: `card-${i}` }).intervalDays;
        expect(Math.abs(fuzzed - base)).toBeLessThanOrEqual(Math.max(1, Math.round(base * 0.05)));
      }
    });

    it("never fuzzes learning steps", () => {
      // Sub-3-day intervals are meant to be precise; a 1-minute relearning
      // step must not wobble.
      const result = calculateNextReview("again", 0, 5, 0, 0, undefined, { fuzzSeed: "card-1" });
      expect(result.intervalDays).toBe(calculateNextReview("again", 0, 5, 0, 0).intervalDays);
    });

    it("previews match scheduling when given the same options", () => {
      const preview = estimateNextInterval("good", MATURE.stability, MATURE.difficulty, MATURE.interval, MATURE.reps, 40, {
        desiredRetention: 0.85,
      });
      const actual = calculateNextReview("good", MATURE.stability, MATURE.difficulty, MATURE.interval, MATURE.reps, 40, {
        desiredRetention: 0.85,
      });
      expect(preview).toBe(getIntervalDisplay(actual.intervalDays));
    });
  });
});

/**
 * The per-learner interval calibration.
 *
 * The stakes are asymmetric: leaving a learner on the stock parameters costs
 * a little efficiency, while a wrong correction actively schedules worse than
 * doing nothing. So most of what follows pins the guardrails, not the curve.
 */
describe("calibrationMultiplier", () => {
  const ENOUGH = 1000;

  it("stays exactly 1 until there is enough evidence", () => {
    // A learner recalling far above target still gets no correction while the
    // sample is thin — the measurement, not the memory, is what's uncertain.
    expect(calibrationMultiplier(0.97, 0.9, 0)).toBe(1);
    expect(calibrationMultiplier(0.97, 0.9, MIN_REVIEWS_TO_CALIBRATE - 1)).toBe(1);
    expect(calibrationMultiplier(0.97, 0.9, MIN_REVIEWS_TO_CALIBRATE)).not.toBe(1);
  });

  it("is 1 when the learner hits their target exactly", () => {
    expect(calibrationMultiplier(0.9, 0.9, ENOUGH)).toBeCloseTo(1, 6);
    // And at a non-default target: the comparison is against what they asked
    // for, not against 90%.
    expect(calibrationMultiplier(0.8, 0.8, ENOUGH)).toBeCloseTo(1, 6);
  });

  it("stretches intervals for memory stronger than the defaults assume", () => {
    expect(calibrationMultiplier(0.95, 0.9, ENOUGH)).toBeGreaterThan(1);
  });

  it("shortens intervals when recall falls short of the target", () => {
    expect(calibrationMultiplier(0.82, 0.9, ENOUGH)).toBeLessThan(1);
  });

  it("moves further as evidence accumulates", () => {
    const early = calibrationMultiplier(0.95, 0.9, 200);
    const later = calibrationMultiplier(0.95, 0.9, 5000);
    // Shrinkage: the same measurement earns a bigger correction once it rests
    // on more reviews, rather than lurching the moment the gate opens.
    expect(later).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(1);
  });

  it("never moves a schedule beyond the clamp, however extreme the input", () => {
    for (const observed of [0.5, 0.6, 0.98, 0.99, 1]) {
      const m = calibrationMultiplier(observed, 0.9, 100000);
      expect(m).toBeGreaterThanOrEqual(0.7);
      expect(m).toBeLessThanOrEqual(1.5);
    }
  });

  it("refuses to act on numbers it cannot use", () => {
    expect(calibrationMultiplier(undefined, 0.9, ENOUGH)).toBe(1);
    expect(calibrationMultiplier(NaN, 0.9, ENOUGH)).toBe(1);
    expect(calibrationMultiplier(0.95, 0.9, NaN)).toBe(1);
    // 0% recall is a broken measurement, not a signal to collapse intervals.
    expect(calibrationMultiplier(0, 0.9, ENOUGH)).toBeGreaterThanOrEqual(0.7);
  });
});

describe("calibration applied to scheduling", () => {
  const established = (options?: Parameters<typeof calculateNextReview>[6]) =>
    calculateNextReview("good", 50, 5, 50, 5, 50, options);

  it("leaves intervals untouched at a multiplier of 1", () => {
    expect(established({ stabilityMultiplier: 1 }).intervalDays).toBe(
      established().intervalDays,
    );
  });

  it("lengthens and shortens the interval with the multiplier", () => {
    const base = established().intervalDays;
    expect(established({ stabilityMultiplier: 1.4 }).intervalDays).toBeGreaterThan(base);
    expect(established({ stabilityMultiplier: 0.75 }).intervalDays).toBeLessThan(base);
  });

  it("does not touch the stored stability", () => {
    // The correction is a scheduling-time adjustment, so recalibrating later
    // must not have corrupted the model's own estimate of memory.
    expect(established({ stabilityMultiplier: 1.4 }).stability).toBe(
      established().stability,
    );
  });

  it("clamps a nonsense multiplier rather than trusting it", () => {
    const wild = established({ stabilityMultiplier: 99 }).intervalDays;
    const capped = established({ stabilityMultiplier: 1.5 }).intervalDays;
    expect(wild).toBe(capped);
    expect(established({ stabilityMultiplier: NaN }).intervalDays).toBe(
      established().intervalDays,
    );
  });
});
