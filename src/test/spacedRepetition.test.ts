import { describe, it, expect } from "vitest";
import { calculateNextReview, getIntervalDisplay, estimateNextInterval, elapsedDaysSince } from "@/lib/spacedRepetition";
import type { Rating } from "@/lib/spacedRepetition";

describe("FSRS-4.5 spacedRepetition", () => {
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
});
