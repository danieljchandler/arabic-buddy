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

/** The ratings a climb can come from: a lapse only lowers a card, and a row with no rating says too little. */
const CLIMBING_RATINGS = new Set(["hard", "good", "easy"]);

/**
 * Whether one logged review was a climb. The log keeps no repetitions before
 * the review; the scheduler adds one on every review but a lapse and a
 * learning card's Hard (which stays at 0), so it is `repetitions_after - 1`,
 * never below 0. Only a Hard, Good or Easy counts. A first review (no
 * stability before) was asked as a new card.
 */
export function isLadderClimb(review: LoggedReview): boolean {
  if (!review.rating || !CLIMBING_RATINGS.has(review.rating)) return false;
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

/** A logged review as the count reads it: which card, when, and what it did. */
export interface LoggedCardReview extends LoggedReview {
  card_id: string;
  reviewed_at: string;
}

/** How far past now a review may be stamped and still count: a clock a little ahead. */
const CLOCK_SKEW_MS = 60_000;
const WEEK_MS = 7 * 86_400_000;

/**
 * One learner's climbs this week, as the database counts them: reviews from
 * this week's Monday, never one stamped in the future, and at most one climb
 * per card, direction and day — a schedule row the learner can write is
 * bounded in what it can buy.
 */
export function countWeekClimbs(reviews: readonly LoggedCardReview[], now: Date): number {
  const start = climbWeekStart(now).getTime();
  const end = Math.min(start + WEEK_MS, now.getTime() + CLOCK_SKEW_MS);
  const climbed = new Set<string>();
  for (const review of reviews) {
    const at = Date.parse(review.reviewed_at);
    if (!(at >= start && at < end) || !isLadderClimb(review)) continue;
    climbed.add(`${review.card_id}|${review.direction}|${new Date(at).toISOString().slice(0, 10)}`);
  }
  return climbed.size;
}
