/**
 * How a learner wants to be reviewed: flip cards they grade themselves, or
 * questions the app grades.
 *
 * The flashcard is the review loop's default and stays exactly as it was —
 * flip, then Again / Hard / Good / Easy. The quiz style serves the same due
 * cards, from the same schedules, as a ladder of questions that get harder as
 * a word's memory state matures (src/lib/quizLadder.ts), and the app writes
 * the rating from the answer (src/lib/quizGrading.ts) instead of asking.
 *
 * The choice lives on `profiles.review_style` so it follows the learner across
 * devices; this module is the device-local cache under that, read in state
 * initialisers so the review page never flashes the wrong style while the
 * profile loads. `useReviewStyle` keeps the two in step. The cache is also the
 * whole preference until the migration that adds the column is applied to the
 * live project (see CLAUDE.md on migrations and `types.ts`): a profile write
 * that fails because the column is missing is swallowed, and the device keeps
 * its own answer.
 */

export type ReviewStyle =
  /** Flip and self-rate — the review loop as it has always been. */
  | "flashcards"
  /** Questions from the ladder, graded by the app. */
  | "quiz";

export const REVIEW_STYLES: readonly ReviewStyle[] = ["flashcards", "quiz"];

export const DEFAULT_REVIEW_STYLE: ReviewStyle = "flashcards";

export function isReviewStyle(value: unknown): value is ReviewStyle {
  return typeof value === "string" && (REVIEW_STYLES as readonly string[]).includes(value);
}

const KEY = "hakiya:review-style";
const EVENT = "hakiya:review-style-changed";

export function loadReviewStyle(): ReviewStyle {
  try {
    const raw = localStorage.getItem(KEY);
    return isReviewStyle(raw) ? raw : DEFAULT_REVIEW_STYLE;
  } catch {
    return DEFAULT_REVIEW_STYLE;
  }
}

export function saveReviewStyle(style: ReviewStyle) {
  try {
    localStorage.setItem(KEY, style);
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function subscribeReviewStyle(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(EVENT, handler as EventListener);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler as EventListener);
    window.removeEventListener("storage", handler);
  };
}
