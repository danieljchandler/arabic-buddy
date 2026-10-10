import { describe, expect, it } from "vitest";
import { climbWeekStart, isLadderClimb, type LoggedReview } from "./ladderClimbs";

/**
 * Ladder climbs as the leaderboard counts them (quiz Phase 7.4), from what
 * `review_log` keeps of a review. What has to hold: a review that moves a
 * word up a step is a climb, one that stays on its step or falls is not, a
 * lapse never is, and the week starts on Monday at midnight UTC as the
 * database's does.
 */

const review = (over: Partial<LoggedReview>): LoggedReview => ({
  direction: "recognition",
  rating: "good",
  stability_before: 3,
  stability_after: 5,
  repetitions_after: 2,
  ...over,
});

describe("isLadderClimb", () => {
  it("is a climb when the memory lands a step up", () => {
    // Fill the gap (under 4 days) → pick the picture (under 8).
    expect(isLadderClimb(review({}))).toBe(true);
  });

  it("is no climb within a step", () => {
    expect(isLadderClimb(review({ stability_before: 5, stability_after: 7, repetitions_after: 3 }))).toBe(false);
  });

  it("counts a new word's first right answer, from a first look", () => {
    expect(isLadderClimb(review({ stability_before: null, stability_after: 3, repetitions_after: 1 }))).toBe(true);
    // Still learning after a first Hard: a first look again.
    expect(isLadderClimb(review({ rating: "hard", stability_before: null, stability_after: 0.5, repetitions_after: 0 }))).toBe(false);
  });

  it("reads a learning card's step from its repetitions, not its stability alone", () => {
    // 0 repetitions before (a first look whatever the stability), 1 after: up a step.
    expect(isLadderClimb(review({ stability_before: 2, stability_after: 3, repetitions_after: 1 }))).toBe(true);
  });

  it("never counts a lapse", () => {
    expect(isLadderClimb(review({ rating: "again", stability_before: 20, stability_after: 2, repetitions_after: 4 }))).toBe(false);
  });

  it("climbs the production steps on their own thresholds", () => {
    // Say it (under 14 days) → say the line.
    expect(isLadderClimb(review({ direction: "production", stability_before: 12, stability_after: 20, repetitions_after: 3 }))).toBe(true);
    expect(isLadderClimb(review({ direction: "production", stability_before: 15, stability_after: 25, repetitions_after: 3 }))).toBe(false);
  });
});

describe("climbWeekStart", () => {
  it("is the Monday before, at midnight UTC", () => {
    // Saturday 10 October 2026.
    expect(climbWeekStart(new Date("2026-10-10T09:00:00Z")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    // A Monday is its own week's start; a Sunday is the end of the week before's.
    expect(climbWeekStart(new Date("2026-10-05T00:00:01Z")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(climbWeekStart(new Date("2026-10-04T23:59:59Z")).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });
});
