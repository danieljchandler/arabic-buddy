/**
 * What a native speaker's tick on a transcript line actually claims, and when
 * it stops being true.
 *
 * A checkmark here means "a human read this exact line and it is right". That
 * claim has an expiry the moment the line changes — and lines change under a
 * tick more often than you would think, because the editor's merge keeps the
 * left-hand line's id while giving it words from the right-hand one. Comparing
 * the current text against the text that was signed off is what turns a tick
 * that has quietly become a lie into a visible "check this again".
 *
 * Pure on purpose: the workspace shows this on every line on every keystroke,
 * and the same rule has to hold in the progress counter, in the row badge, and
 * in the filter.
 */

export interface LineReview {
  lineId: string;
  reviewedBy: string;
  reviewedAt: string;
  /** The Arabic that was approved. Null on rows written before snapshots existed. */
  reviewedArabic: string | null;
  /** The English that was approved. Null on rows written before snapshots existed. */
  reviewedTranslation: string | null;
}

export interface ReviewableLine {
  id: string;
  arabic?: string;
  translation?: string;
}

export type ReviewState =
  /** Nobody has signed this off. */
  | "unreviewed"
  /** Signed off, and the text still matches what was signed off. */
  | "reviewed"
  /** Signed off, but the text has moved on since. */
  | "stale";

/** Whitespace-insensitive: reflowing a line is not a change to its content. */
function sameText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");
}

export function reviewStateFor(
  review: LineReview | undefined,
  line: Pick<ReviewableLine, "arabic" | "translation">,
): ReviewState {
  if (!review) return "unreviewed";

  // A row with no snapshot predates the column. It cannot be shown as stale
  // without accusing every historical tick of being out of date, and it cannot
  // be proven current either — so it is taken at face value, which is what it
  // meant when it was written.
  if (review.reviewedArabic === null && review.reviewedTranslation === null) {
    return "reviewed";
  }

  const arabicMoved =
    review.reviewedArabic !== null && !sameText(review.reviewedArabic, line.arabic ?? "");
  const translationMoved =
    review.reviewedTranslation !== null &&
    !sameText(review.reviewedTranslation, line.translation ?? "");

  return arabicMoved || translationMoved ? "stale" : "reviewed";
}

export interface ReviewProgress {
  total: number;
  reviewed: number;
  stale: number;
  unreviewed: number;
  /** Whole percent of lines carrying a tick that is still valid. */
  percent: number;
}

/**
 * How far through a video the review is.
 *
 * A stale tick counts as outstanding work, not as progress — the point of the
 * number is to answer "is this video done", and a line whose approved text has
 * since changed is not done.
 */
export function reviewProgress(
  lines: readonly ReviewableLine[],
  reviews: ReadonlyMap<string, LineReview>,
): ReviewProgress {
  let reviewed = 0;
  let stale = 0;

  for (const line of lines) {
    const state = reviewStateFor(reviews.get(line.id), line);
    if (state === "reviewed") reviewed += 1;
    else if (state === "stale") stale += 1;
  }

  const total = lines.length;
  return {
    total,
    reviewed,
    stale,
    unreviewed: total - reviewed - stale,
    percent: total === 0 ? 0 : Math.round((reviewed / total) * 100),
  };
}

/** Index review rows by the line they belong to. */
export function indexReviews(reviews: readonly LineReview[]): Map<string, LineReview> {
  return new Map(reviews.map((review) => [review.lineId, review]));
}

export type LineFilter = "all" | "unreviewed" | "stale" | "commented" | "needs_review";

/**
 * Narrow a transcript to the lines a reviewer asked to see.
 *
 * `needs_review` is the pipeline's own flag — the translation ensemble sets it
 * when its models disagreed — and is a different question from whether a person
 * has looked at the line. A reviewer opening a fresh video usually wants that
 * filter first: it is the machine pointing at the lines it is least sure of.
 */
export function filterLines<T extends ReviewableLine & { needs_review?: boolean }>(
  lines: readonly T[],
  filter: LineFilter,
  reviews: ReadonlyMap<string, LineReview>,
  commentedLineIds: ReadonlySet<string>,
): T[] {
  switch (filter) {
    case "unreviewed":
      return lines.filter((l) => reviewStateFor(reviews.get(l.id), l) === "unreviewed");
    case "stale":
      return lines.filter((l) => reviewStateFor(reviews.get(l.id), l) === "stale");
    case "commented":
      return lines.filter((l) => commentedLineIds.has(l.id));
    case "needs_review":
      return lines.filter((l) => l.needs_review === true);
    case "all":
    default:
      return [...lines];
  }
}
