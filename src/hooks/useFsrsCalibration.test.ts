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
  stats: undefined as { retentionRate: number; reviewedCount: number } | undefined,
  retention: 0.9,
}));

vi.mock("@/hooks/useSRSStats", () => ({
  useSRSStats: () => ({ data: state.stats }),
}));
vi.mock("@/hooks/useDesiredRetention", () => ({
  useDesiredRetention: () => state.retention,
}));

const calibration = () => renderHook(() => useFsrsCalibration()).result.current;

describe("useFsrsCalibration", () => {
  it("leaves the schedule alone before the stats have loaded", () => {
    state.stats = undefined;
    expect(calibration()).toBe(1);
  });

  it("leaves the schedule alone on a thin review history", () => {
    state.stats = { retentionRate: 97, reviewedCount: MIN_REVIEWS_TO_CALIBRATE - 1 };
    expect(calibration()).toBe(1);
  });

  it("stretches intervals for a learner recalling above their target", () => {
    state.stats = { retentionRate: 96, reviewedCount: 2000 };
    state.retention = 0.9;
    expect(calibration()).toBeGreaterThan(1);
  });

  it("shortens intervals for a learner recalling below their target", () => {
    state.stats = { retentionRate: 80, reviewedCount: 2000 };
    state.retention = 0.9;
    expect(calibration()).toBeLessThan(1);
  });

  it("compares against the learner's own target, not a fixed 90%", () => {
    // 85% recall is short of the default but exactly what this learner asked
    // for, so their schedule should not move.
    state.stats = { retentionRate: 85, reviewedCount: 2000 };
    state.retention = 0.85;
    expect(calibration()).toBeCloseTo(1, 6);
  });

  it("converts the display percentage to the curve's 0..1 scale", () => {
    // retentionRate is a 0–100 integer for display; feeding it through raw
    // would read as a 9000% recall rate and produce nonsense.
    state.stats = { retentionRate: 90, reviewedCount: 2000 };
    state.retention = 0.9;
    expect(calibration()).toBeCloseTo(1, 6);
  });
});
