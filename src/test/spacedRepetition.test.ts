import { describe, it, expect } from "vitest";
import { calculateNextReview, getIntervalDisplay, estimateNextInterval } from "@/lib/spacedRepetition";
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
});
