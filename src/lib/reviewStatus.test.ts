import { describe, expect, it } from "vitest";
import {
  filterLines,
  indexReviews,
  reviewProgress,
  reviewStateFor,
  type LineReview,
} from "./reviewStatus";

const review = (over: Partial<LineReview> = {}): LineReview => ({
  lineId: "L1",
  reviewedBy: "reviewer-1",
  reviewedAt: "2026-08-24T10:00:00Z",
  reviewedArabic: "شلونك اليوم",
  reviewedTranslation: "How are you today",
  ...over,
});

const line = (over: Record<string, unknown> = {}) => ({
  id: "L1",
  arabic: "شلونك اليوم",
  translation: "How are you today",
  ...over,
});

describe("reviewStateFor", () => {
  it("calls a line with no review unreviewed", () => {
    expect(reviewStateFor(undefined, line())).toBe("unreviewed");
  });

  it("calls a line reviewed when the text still matches the snapshot", () => {
    expect(reviewStateFor(review(), line())).toBe("reviewed");
  });

  it("goes stale when the Arabic changes after sign-off", () => {
    expect(reviewStateFor(review(), line({ arabic: "شخبارك اليوم" }))).toBe("stale");
  });

  it("goes stale when the translation changes after sign-off", () => {
    expect(reviewStateFor(review(), line({ translation: "How's it going" }))).toBe("stale");
  });

  it("goes stale when a merge gives the line words nobody checked", () => {
    // mergeSegments keeps the left line's id, so without the snapshot the tick
    // would silently carry over onto text that now includes the right line.
    expect(reviewStateFor(review(), line({ arabic: "شلونك اليوم زين الحمدلله" }))).toBe("stale");
  });

  it("does not go stale over reflowed whitespace", () => {
    expect(reviewStateFor(review(), line({ arabic: "شلونك   اليوم " }))).toBe("reviewed");
  });

  it("takes a snapshot-less row at face value", () => {
    const legacy = review({ reviewedArabic: null, reviewedTranslation: null });
    expect(reviewStateFor(legacy, line({ arabic: "something else entirely" }))).toBe("reviewed");
  });

  it("still checks the half of a partial snapshot that is present", () => {
    const partial = review({ reviewedTranslation: null });
    expect(reviewStateFor(partial, line({ translation: "anything" }))).toBe("reviewed");
    expect(reviewStateFor(partial, line({ arabic: "غير" }))).toBe("stale");
  });

  it("treats an emptied line as a change", () => {
    expect(reviewStateFor(review(), line({ arabic: "" }))).toBe("stale");
  });
});

describe("reviewProgress", () => {
  const lines = [line({ id: "L1" }), line({ id: "L2" }), line({ id: "L3" })];

  it("counts nothing as done on a fresh video", () => {
    expect(reviewProgress(lines, new Map())).toEqual({
      total: 3,
      reviewed: 0,
      stale: 0,
      unreviewed: 3,
      percent: 0,
    });
  });

  it("counts a valid tick as progress", () => {
    const reviews = indexReviews([review({ lineId: "L1" })]);
    expect(reviewProgress(lines, reviews)).toMatchObject({ reviewed: 1, unreviewed: 2, percent: 33 });
  });

  it("counts a stale tick as outstanding work, not as progress", () => {
    const reviews = indexReviews([
      review({ lineId: "L1" }),
      review({ lineId: "L2", reviewedArabic: "text that has since changed" }),
    ]);

    expect(reviewProgress(lines, reviews)).toEqual({
      total: 3,
      reviewed: 1,
      stale: 1,
      unreviewed: 1,
      percent: 33,
    });
  });

  it("reports a fully reviewed video as complete", () => {
    const reviews = indexReviews(["L1", "L2", "L3"].map((lineId) => review({ lineId })));
    expect(reviewProgress(lines, reviews).percent).toBe(100);
  });

  it("does not divide by zero on an empty transcript", () => {
    expect(reviewProgress([], new Map())).toEqual({
      total: 0,
      reviewed: 0,
      stale: 0,
      unreviewed: 0,
      percent: 0,
    });
  });
});

describe("filterLines", () => {
  const lines = [
    line({ id: "L1" }),
    line({ id: "L2", arabic: "زين" }),
    line({ id: "L3", needs_review: true }),
  ];
  const reviews = indexReviews([
    review({ lineId: "L1" }),
    review({ lineId: "L2", reviewedArabic: "stale snapshot" }),
  ]);
  const commented = new Set(["L3"]);

  it("passes everything through on 'all'", () => {
    expect(filterLines(lines, "all", reviews, commented)).toHaveLength(3);
  });

  it("finds the lines nobody has opened", () => {
    expect(filterLines(lines, "unreviewed", reviews, commented).map((l) => l.id)).toEqual(["L3"]);
  });

  it("finds the ticks that have gone stale", () => {
    expect(filterLines(lines, "stale", reviews, commented).map((l) => l.id)).toEqual(["L2"]);
  });

  it("finds the lines with comments on them", () => {
    expect(filterLines(lines, "commented", reviews, commented).map((l) => l.id)).toEqual(["L3"]);
  });

  it("finds the lines the pipeline itself flagged", () => {
    expect(filterLines(lines, "needs_review", reviews, commented).map((l) => l.id)).toEqual(["L3"]);
  });

  it("returns a copy rather than the caller's array", () => {
    const all = filterLines(lines, "all", reviews, commented);
    expect(all).not.toBe(lines);
  });
});
