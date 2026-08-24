import { describe, expect, it } from "vitest";
import {
  diffTranscriptRevisions,
  diffVideoField,
  formatTiming,
  MAX_REVISIONS_PER_SAVE,
} from "../../supabase/functions/_shared/transcriptRevisionCore";

/**
 * The audit trail behind the review workspace.
 *
 * The duty here is the opposite of `transcriptDiffCore`'s. That one builds
 * training pairs and is right to stay silent when it cannot be sure; this one
 * has to account for every edit, because a log that quietly omits the changes
 * it found hard to describe is not a log. So the cases that matter most are the
 * structural ones — splits, merges, deletions — which the training diff drops
 * on purpose.
 */

const line = (over: Record<string, unknown> = {}) => ({
  id: "L1",
  arabic: "الليلة نروح إلى السوق",
  translation: "Tonight we go to the market",
  startMs: 41_200,
  endMs: 44_700,
  ...over,
});

describe("field edits", () => {
  it("records an Arabic correction with both sides", () => {
    const revisions = diffTranscriptRevisions(
      [line()],
      [line({ arabic: "الليلة نروح السوق" })],
    );

    expect(revisions).toEqual([
      {
        lineId: "L1",
        field: "arabic",
        previousValue: "الليلة نروح إلى السوق",
        newValue: "الليلة نروح السوق",
      },
    ]);
  });

  it("records a translation correction", () => {
    const revisions = diffTranscriptRevisions(
      [line()],
      [line({ translation: "We're going to the market tonight" })],
    );

    expect(revisions).toHaveLength(1);
    expect(revisions[0].field).toBe("translation");
    expect(revisions[0].previousValue).toBe("Tonight we go to the market");
  });

  it("records a literal gloss correction", () => {
    const revisions = diffTranscriptRevisions(
      [line({ literal: "tonight we-go to the-market" })],
      [line({ literal: "the-night we-go to the-market" })],
    );

    expect(revisions).toHaveLength(1);
    expect(revisions[0].field).toBe("literal");
  });

  it("reports several fields changing on one line separately", () => {
    const revisions = diffTranscriptRevisions(
      [line()],
      [line({ arabic: "نروح السوق", translation: "We go to the market" })],
    );

    expect(revisions.map((r) => r.field).sort()).toEqual(["arabic", "translation"]);
  });

  it("treats reflowing whitespace as no change", () => {
    const revisions = diffTranscriptRevisions(
      [line()],
      [line({ arabic: "الليلة   نروح\nإلى السوق" })],
    );

    expect(revisions).toEqual([]);
  });

  it("says nothing about a line nobody touched", () => {
    expect(diffTranscriptRevisions([line()], [line()])).toEqual([]);
  });

  it("records a field being emptied", () => {
    const revisions = diffTranscriptRevisions([line()], [line({ translation: "" })]);

    expect(revisions).toHaveLength(1);
    expect(revisions[0].field).toBe("translation");
    expect(revisions[0].newValue).toBeNull();
  });

  it("records a field being filled in for the first time", () => {
    const revisions = diffTranscriptRevisions(
      [line({ literal: "" })],
      [line({ literal: "tonight we-go to the-market" })],
    );

    expect(revisions).toHaveLength(1);
    expect(revisions[0].previousValue).toBeNull();
    expect(revisions[0].newValue).toBe("tonight we-go to the-market");
  });
});

describe("timing", () => {
  it("records a retimed boundary in seconds", () => {
    const revisions = diffTranscriptRevisions([line()], [line({ endMs: 45_200 })]);

    expect(revisions).toEqual([
      {
        lineId: "L1",
        field: "timing",
        previousValue: "41.20s → 44.70s",
        newValue: "41.20s → 45.20s",
      },
    ]);
  });

  it("does not call a sub-millisecond nudge a change", () => {
    const revisions = diffTranscriptRevisions([line()], [line({ endMs: 44_700.4 })]);
    expect(revisions).toEqual([]);
  });

  it("formats a half-open span", () => {
    expect(formatTiming(1500, undefined)).toBe("1.50s → ?");
  });

  it("has nothing to say about a line with no timings at all", () => {
    expect(formatTiming(undefined, undefined)).toBeNull();
  });
});

describe("structure", () => {
  it("records a merge as the right-hand line disappearing", () => {
    // mergeSegments keeps the left id and drops the right one.
    const before = [line(), line({ id: "L2", arabic: "بروحي", startMs: 44_700, endMs: 46_000 })];
    const after = [line({ arabic: "الليلة نروح إلى السوق بروحي", endMs: 46_000 })];

    const revisions = diffTranscriptRevisions(before, after);
    const removal = revisions.find((r) => r.field === "structure");

    expect(removal).toEqual({
      lineId: "L2",
      field: "structure",
      previousValue: "بروحي",
      newValue: null,
    });
  });

  it("records a split as a new line appearing", () => {
    // splitSegment keeps the left half's id and mints a new one for the right.
    const before = [line()];
    const after = [
      line({ arabic: "الليلة نروح", endMs: 43_000 }),
      { id: "L9", arabic: "إلى السوق", translation: "", startMs: 43_000, endMs: 44_700 },
    ];

    const revisions = diffTranscriptRevisions(before, after);
    const addition = revisions.find((r) => r.lineId === "L9");

    expect(addition).toEqual({
      lineId: "L9",
      field: "structure",
      previousValue: null,
      newValue: "إلى السوق",
    });
  });

  it("records a deleted line", () => {
    const revisions = diffTranscriptRevisions([line(), line({ id: "L2" })], [line()]);

    expect(revisions).toEqual([
      { lineId: "L2", field: "structure", previousValue: "الليلة نروح إلى السوق", newValue: null },
    ]);
  });
});

describe("guards", () => {
  it("skips a line with no id — there is nothing to attach the change to", () => {
    const revisions = diffTranscriptRevisions(
      [{ arabic: "أول", startMs: 0 }],
      [{ arabic: "ثاني", startMs: 0 }],
    );
    expect(revisions).toEqual([]);
  });

  it("diffs against the first of two lines sharing an id, not both", () => {
    const before = [line({ arabic: "أول" }), line({ arabic: "ثاني" })];
    const revisions = diffTranscriptRevisions(before, [line({ arabic: "ثالث" })]);

    expect(revisions).toHaveLength(1);
    expect(revisions[0].previousValue).toBe("أول");
  });

  it("stops at the cap rather than logging a whole regeneration", () => {
    const before = Array.from({ length: 400 }, (_, i) => line({ id: `L${i}`, arabic: `قبل ${i}` }));
    const after = Array.from({ length: 400 }, (_, i) => line({ id: `L${i}`, arabic: `بعد ${i}` }));

    expect(diffTranscriptRevisions(before, after)).toHaveLength(MAX_REVISIONS_PER_SAVE);
  });

  it("honours a caller-supplied cap", () => {
    const before = Array.from({ length: 10 }, (_, i) => line({ id: `L${i}`, arabic: `قبل ${i}` }));
    const after = Array.from({ length: 10 }, (_, i) => line({ id: `L${i}`, arabic: `بعد ${i}` }));

    expect(diffTranscriptRevisions(before, after, 3)).toHaveLength(3);
  });

  it("returns nothing for input that is not a pair of arrays", () => {
    expect(diffTranscriptRevisions(null, [line()])).toEqual([]);
    expect(diffTranscriptRevisions([line()], "nope")).toEqual([]);
  });

  it("truncates a value too long to be a useful diff", () => {
    const long = "ا".repeat(5000);
    const revisions = diffTranscriptRevisions([line()], [line({ arabic: long })]);

    expect(revisions[0].newValue).toHaveLength(4001);
    expect(revisions[0].newValue?.endsWith("…")).toBe(true);
  });
});

describe("video-level fields", () => {
  it("records a cultural-note edit", () => {
    const revision = diffVideoField("cultural_context", "Old note.", "New note.");

    expect(revision).toEqual({
      lineId: null,
      field: "cultural_context",
      previousValue: "Old note.",
      newValue: "New note.",
    });
  });

  it("says nothing when a note is unchanged", () => {
    expect(diffVideoField("cultural_context", "Same.", "Same.")).toBeNull();
  });

  it("renders structured fields as JSON so the two can be read side by side", () => {
    const revision = diffVideoField(
      "grammar_points",
      [{ title: "Negation", explanation: "ما before the verb." }],
      [{ title: "Negation", explanation: "مو before a noun, ما before a verb." }],
    );

    expect(revision?.field).toBe("grammar_points");
    expect(revision?.previousValue).toContain("ما before the verb.");
    expect(revision?.newValue).toContain("مو before a noun");
  });

  it("treats an absent note and an empty one as the same", () => {
    expect(diffVideoField("cultural_context", null, "")).toBeNull();
  });

  it("records a note being added for the first time", () => {
    const revision = diffVideoField("cultural_context", null, "First note.");

    expect(revision?.previousValue).toBeNull();
    expect(revision?.newValue).toBe("First note.");
  });
});
