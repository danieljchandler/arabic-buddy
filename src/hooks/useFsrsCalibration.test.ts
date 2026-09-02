import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFsrsCalibration } from "./useFsrsCalibration";
import { MIN_REVIEWS_TO_CALIBRATE } from "@/lib/spacedRepetition";

/**
 * The glue between measured recall and the scheduler.
 *
 * The load-bearing rule is the same one the multiplier itself enforces, but
 * it has to survive the trip through the cache: a learner the app knows
 * almost nothing about gets exactly 1, because a wrong correction schedules
 * worse than leaving the stock parameters alone.
 */

const state = vi.hoisted(() => ({
  stats: undefined as
    | { recentRetentionRate: number; recentReviewedCount: number }
    | undefined,
  retention: 0.9,
  weights: null as readonly number[] | null,
}));

vi.mock("@/hooks/useSRSStats", () => ({
  useSRSStats: () => ({ data: state.stats }),
}));
vi.mock("@/hooks/useDesiredRetention", () => ({
  useDesiredRetention: () => state.retention,
}));
vi.mock("@/hooks/useFsrsWeights", () => ({
  useFsrsWeights: () => ({ weights: state.weights, fittedAt: null, reviews: null, isLoading: false }),
}));

const calibration = () => renderHook(() => useFsrsCalibration()).result.current;

describe("useFsrsCalibration", () => {
  it("steps aside entirely once the learner has fitted weights", () => {
    // A fitted vector already encodes how this memory differs from the
    // defaults; correcting for it again would double-count.
    state.stats = { recentRetentionRate: 96, recentReviewedCount: 2000 };
    state.retention = 0.9;
    state.weights = new Array(21).fill(0.5);
    expect(calibration()).toBe(1);
    state.weights = null;
  });

  it("leaves the schedule alone before the stats have loaded", () => {
    state.stats = undefined;
    expect(calibration()).toBe(1);
  });

  it("leaves the schedule alone on a thin review history", () => {
    state.stats = { recentRetentionRate: 97, recentReviewedCount: MIN_REVIEWS_TO_CALIBRATE - 1 };
    expect(calibration()).toBe(1);
  });

  it("stretches intervals for a learner recalling above their target", () => {
    state.stats = { recentRetentionRate: 96, recentReviewedCount: 2000 };
    state.retention = 0.9;
    expect(calibration()).toBeGreaterThan(1);
  });

  it("shortens intervals for a learner recalling below their target", () => {
    state.stats = { recentRetentionRate: 80, recentReviewedCount: 2000 };
    state.retention = 0.9;
    expect(calibration()).toBeLessThan(1);
  });

  it("compares against the learner's own target, not a fixed 90%", () => {
    // 85% recall is short of the default but exactly what this learner asked
    // for, so their schedule should not move.
    state.stats = { recentRetentionRate: 85, recentReviewedCount: 2000 };
    state.retention = 0.85;
    expect(calibration()).toBeCloseTo(1, 6);
  });

  it("converts the display percentage to the curve's 0..1 scale", () => {
    // retentionRate is a 0–100 integer for display; feeding it through raw
    // would read as a 9000% recall rate and produce nonsense.
    state.stats = { recentRetentionRate: 90, recentReviewedCount: 2000 };
    state.retention = 0.9;
    expect(calibration()).toBeCloseTo(1, 6);
  });
});

describe("the calibration window", () => {
  it("reads the windowed recall, never the lifetime figure", () => {
    // A learner whose early months were rough but who now recalls above
    // target: lifetime says "compress", the last sixty days say "stretch".
    // Calibration must listen to the window — the all-time average never
    // forgets, so a rough start otherwise compressed intervals forever.
    state.stats = {
      recentRetentionRate: 96,
      recentReviewedCount: 2000,
      // Lifetime figures ride along as the real hook returns them…
      retentionRate: 70,
      reviewedCount: 9000,
    } as never;
    state.retention = 0.9;
    expect(calibration()).toBeGreaterThan(1);
  });
});
