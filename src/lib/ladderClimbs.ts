import { rungForMemory, type QuizDirection } from "@/lib/quizLadder";

/**
 * Ladder climbs, as the leaderboard counts them (quiz Phase 7.4).
 *
 * The count itself is the database's (`leaderboard_climbs`, migration
 * 20261010120000_leaderboard_climbs), read from `review_log`, which only
 * triggers write. This is the same rule in TypeScript, for the in-memory
 * backend that stands in for the database in tests, and as the statement of
 * the rule the SQL must keep (`src/test/leaderboardClimbs.test.ts` holds the
 * SQL's thresholds to `LADDER_THRESHOLDS`).
 *
 * A review climbs when the ladder step its memory lands on is above the step
 * it was asked at, the step the session summary's "Climbed" counts too.
 */

/** What a `review_log` row says about one review. */
export interface LoggedReview {
  direction: QuizDirection;
  rating: string | null;
  stability_before: number | null;
  stability_after: number | null;
  repetitions_after: number | null;
}

/**
 * Whether one logged review was a climb. The log keeps no repetitions before
 * the review; the scheduler adds one on every review but a lapse and a
 * learning card's Hard (which stays at 0), so it is `repetitions_after - 1`,
 * never below 0. A lapse is never a climb, since its stability only falls. A
 * first review (no stability before) was asked as a new card.
 */
export function isLadderClimb(review: LoggedReview): boolean {
  if (review.rating === "again") return false;
  const firstReview = review.stability_before == null;
  const before = rungForMemory(
    {
      stability: review.stability_before ?? 0,
      repetitions: firstReview ? 0 : Math.max((review.repetitions_after ?? 0) - 1, 0),
    },
    review.direction,
  ).step;
  const after = rungForMemory(
    { stability: review.stability_after ?? 0, repetitions: review.repetitions_after ?? 0 },
    review.direction,
  ).step;
  return after > before;
}

/** The start of the week the board counts: Monday 00:00 UTC, as Postgres's `date_trunc('week')`. */
export function climbWeekStart(now: Date): Date {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
}
