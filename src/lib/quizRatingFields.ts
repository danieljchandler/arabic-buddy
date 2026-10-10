import type { QuizFormat } from "@/lib/quizLadder";

/**
 * What a curriculum rating was asked as (quiz Phase 8): the quiz format and
 * the ladder step of the question, written on `word_reviews` with the rating
 * (`last_quiz_format`, `last_quiz_step`) so the `review_log` trigger copies
 * them into the log beside the memory state either side of the review. That
 * is what lets a report tell a gap from a picture, and a boss or a fallback
 * from the ladder's own question, when it sets the thresholds from real
 * ratings.
 *
 * They are stamped with the rating's own moment (`last_quiz_at`, the same
 * string as the direction's `last_reviewed_at`), and the trigger copies them
 * only when the two match: a write that moves `last_reviewed_at` without
 * them (an older tab, a device that has stopped sending them) is logged with
 * no question rather than with the previous rating's.
 *
 * The columns come with migration 20261010130000_quiz_rating_asked, which is
 * an owner action (Phase 8b): merged through GitHub it is not on the live
 * project, and PostgREST refuses a write that names a column it does not have.
 * A rating must never fail for want of these, so a write that is refused for
 * one of them is sent again without them (`isMissingQuizColumn`), and the
 * device stops sending them for a day (`markQuizColumnsMissing`), when it
 * tries again, so the fields start flowing once the owner has applied it.
 */

/** What a rating was asked as. Absent for a flip card, which the learner rated. */
export interface QuizAsked {
  format: QuizFormat;
  step: number;
}

/** Device-local: when to try the columns again. */
const MISSING_KEY = "hakiya:quiz-rating-fields-missing-until";
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

let missingUntil: number | null = null;

function readMissingUntil(): number {
  if (missingUntil != null) return missingUntil;
  try {
    const stored = Number(localStorage.getItem(MISSING_KEY));
    missingUntil = Number.isFinite(stored) ? stored : 0;
  } catch {
    missingUntil = 0;
  }
  return missingUntil;
}

/** Whether to send the fields now: not while the columns are known to be missing. */
export function quizColumnsAvailable(nowMs: number = Date.now()): boolean {
  return nowMs >= readMissingUntil();
}

/** The live project has no such columns yet: stop sending them for a day. */
export function markQuizColumnsMissing(nowMs: number = Date.now()): void {
  missingUntil = nowMs + RETRY_AFTER_MS;
  try {
    localStorage.setItem(MISSING_KEY, String(missingUntil));
  } catch {
    // Storage may be blocked; the page load still remembers.
  }
}

/**
 * The fields for a rating write: what it was asked as, stamped with the
 * rating's `last_reviewed_at` (`reviewedAt`), or nulls for a flip card. Every
 * rating sends them while the columns are there, nulls included, so the row
 * never holds a question the learner was not asked.
 */
export function quizRatingFields(
  asked: QuizAsked | null | undefined,
  reviewedAt: string,
  nowMs: number = Date.now(),
): Record<string, unknown> {
  if (!quizColumnsAvailable(nowMs)) return {};
  return asked
    ? { last_quiz_format: asked.format, last_quiz_step: asked.step, last_quiz_at: reviewedAt }
    : { last_quiz_format: null, last_quiz_step: null, last_quiz_at: null };
}

/** The write without them, to send again when the project has no such columns. */
export function withoutQuizFields(write: Record<string, unknown>): Record<string, unknown> {
  const { last_quiz_format: _format, last_quiz_step: _step, last_quiz_at: _at, ...rest } = write;
  return rest;
}

/**
 * Whether an error is the project refusing a write for one of these columns:
 * PostgREST's "column not in the schema cache" (PGRST204), or Postgres's
 * "column does not exist" (42703).
 */
export function isMissingQuizColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code !== "PGRST204" && code !== "42703") return false;
  return /last_quiz_(format|step|at)/.test(error.message ?? "");
}

/** For tests: forget what this page load learned. */
export function resetQuizColumnsForTests(): void {
  missingUntil = null;
}
