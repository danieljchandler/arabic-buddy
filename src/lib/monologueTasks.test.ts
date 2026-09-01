import { describe, expect, it } from "vitest";
import {
  formatClock,
  latestDelta,
  metricValue,
  taskSpecForLevel,
  TREND_METRICS,
} from "./monologueTasks";

/**
 * The level-scaling policy for monologue tasks.
 *
 * The numbers encode the research finding that matters most for retention:
 * A-level speakers cannot fill long recordings, so a beginner must never be
 * handed the advanced 3-5 minute ask. If someone "simplifies" this to one
 * fixed duration, these tests are what goes red.
 */

describe("task spec by level", () => {
  it("keeps beginner targets short and paired", () => {
    for (const level of ["A1", "A2", null, undefined, "??"]) {
      const spec = taskSpecForLevel(level);
      expect(spec.band).toBe("beginner");
      // Under a minute per prompt, several prompts — the fillable shape.
      expect(spec.targetSeconds).toBeLessThan(60);
      expect(spec.promptCount).toBeGreaterThan(1);
    }
  });

  it("reserves the long free-form monologue for advanced learners", () => {
    const spec = taskSpecForLevel("C1");
    expect(spec.band).toBe("advanced");
    expect(spec.targetSeconds).toBeGreaterThanOrEqual(180);
    expect(spec.promptCount).toBe(1);
  });

  it("scales monotonically from A to C", () => {
    const a = taskSpecForLevel("A2");
    const b = taskSpecForLevel("B1");
    const c = taskSpecForLevel("C2");
    expect(a.targetSeconds).toBeLessThan(b.targetSeconds);
    expect(b.targetSeconds).toBeLessThan(c.targetSeconds);
  });

  it("caps every band comfortably past its target, never at it", () => {
    for (const level of ["A1", "B1", "C1"]) {
      const spec = taskSpecForLevel(level);
      // A cap equal to the target turns the target into a cutoff — the
      // recorder would stop learners mid-sentence at exactly the goal.
      expect(spec.hardCapSeconds).toBeGreaterThan(spec.targetSeconds * 1.3);
    }
  });

  it("is case-insensitive about the CEFR string", () => {
    expect(taskSpecForLevel("b2").band).toBe("intermediate");
  });
});

describe("clock formatting", () => {
  it("renders minutes and zero-padded seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(95)).toBe("1:35");
    expect(formatClock(240)).toBe("4:00");
  });

  it("never renders a negative clock", () => {
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("trend deltas", () => {
  it("compares the latest attempt to the mean of the earlier ones", () => {
    expect(latestDelta([2, 3, 4])).toBeCloseTo(4 - 2.5, 5);
  });

  it("stays null until there is anything to compare", () => {
    // A delta against nothing invites reading noise as progress.
    expect(latestDelta([])).toBeNull();
    expect(latestDelta([3])).toBeNull();
    expect(latestDelta([null, 3])).toBeNull();
  });

  it("skips attempts that carried no timing metrics", () => {
    expect(latestDelta([2, null, 4])).toBeCloseTo(2, 5);
  });
});

describe("trend metric definitions", () => {
  it("charts speed and pause measures, never repairs", () => {
    // Repair counts are non-linear across levels — descriptive only, and a
    // trend arrow on them would be a claim the evidence doesn't support.
    const keys = TREND_METRICS.map((m) => m.key) as string[];
    expect(keys).toContain("speechRateSylPerSec");
    expect(keys.some((k) => /repetition|repair/i.test(k))).toBe(false);
  });

  it("reads values out of stored attempt jsonb defensively", () => {
    expect(metricValue({ speechRateSylPerSec: 2.5 }, "speechRateSylPerSec")).toBe(2.5);
    expect(metricValue({}, "speechRateSylPerSec")).toBeNull();
    expect(metricValue(null, "speechRateSylPerSec")).toBeNull();
    expect(metricValue({ speechRateSylPerSec: "fast" }, "speechRateSylPerSec")).toBeNull();
  });
});
