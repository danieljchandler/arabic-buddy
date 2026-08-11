import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Segment } from "@/types/transcript";
import DiffPreview from "./DiffPreview";

/**
 * The approval gate for AI re-segmentation.
 *
 * Re-segmenting rewrites every line boundary in a transcript at once, so it is
 * never applied directly — the proposal is shown against what is already there
 * and an admin accepts it, rejects it, or picks through it line by line. The
 * component's whole job is answering "what actually changed?", and it answers
 * it by comparing start/end pairs: a suggested line whose boundary is not in
 * the original is new and gets buttons, an original whose boundary is gone is
 * struck through.
 */

const aSegment = (over: Partial<Segment> = {}): Segment => ({
  id: "s1",
  video_id: "v",
  start: 0,
  end: 1,
  text: "مرحبا",
  translation: "hello",
  confidence: 1,
  words: [],
  ...over,
});

interface Options {
  original?: Segment[];
  suggested?: Segment[];
}

function renderDiff({ original = [], suggested = [] }: Options = {}) {
  const handlers = {
    onAcceptAll: vi.fn(),
    onRejectAll: vi.fn(),
    onAcceptOne: vi.fn(),
    onRejectOne: vi.fn(),
  };
  const result = render(<DiffPreview original={original} suggested={suggested} {...handlers} />);
  return { ...result, ...handlers };
}

const acceptRow = (n = 0) => screen.getAllByRole("button", { name: "✓" })[n];
const rejectRow = (n = 0) => screen.getAllByRole("button", { name: "✗" })[n];

describe("DiffPreview — deciding what changed", () => {
  it("marks a suggested line the original did not have", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 2 })],
      suggested: [aSegment({ start: 0, end: 1, text: "first half" })],
    });
    expect(container.querySelector(".border-green-500")).toBeInTheDocument();
  });

  it("leaves an unchanged line unmarked", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 2 })],
      suggested: [aSegment({ start: 0, end: 2 })],
    });
    expect(container.querySelector(".border-green-500")).toBeNull();
  });

  it("strikes through a boundary the proposal drops", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 1, text: "gone" }), aSegment({ start: 1, end: 2 })],
      suggested: [aSegment({ start: 1, end: 2 })],
    });
    const removed = container.querySelector(".line-through");
    expect(removed).toBeInTheDocument();
    expect(removed).toHaveTextContent("gone");
  });

  it("keeps a line that only moved its text", () => {
    // The comparison is on boundaries alone, so a re-worded line at the same
    // timestamps is not a boundary change and is not offered for approval.
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 2, text: "before" })],
      suggested: [aSegment({ start: 0, end: 2, text: "after" })],
    });
    expect(container.querySelector(".border-green-500")).toBeNull();
    expect(container.querySelector(".line-through")).toBeNull();
  });

  it("shows both halves of a split as new and the whole as removed", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 2, text: "one long line" })],
      suggested: [
        aSegment({ start: 0, end: 1, text: "first" }),
        aSegment({ start: 1, end: 2, text: "second" }),
      ],
    });
    expect(container.querySelectorAll(".border-green-500")).toHaveLength(2);
    expect(container.querySelectorAll(".line-through")).toHaveLength(1);
  });

  it("copes with an empty proposal", () => {
    const { container } = renderDiff({ original: [aSegment()], suggested: [] });
    expect(container.querySelectorAll(".line-through")).toHaveLength(1);
  });

  it("copes with an empty original", () => {
    renderDiff({ original: [], suggested: [aSegment({ text: "brand new" })] });
    expect(screen.getByText("brand new")).toBeInTheDocument();
  });

  /**
   * FINDING — boundaries are compared as strings, so float noise makes every
   * line look new.
   *
   * The key is `${s.start}-${s.end}` — an exact string match on numbers that
   * came out of arithmetic. The re-segmentation path rebuilds each segment's
   * start and end by summing word durations, so a boundary that is
   * conceptually unchanged comes back as 1.2000000000000002 against the
   * original's 1.2 and stringifies differently.
   *
   * The result is that the diff turns entirely green, every original line is
   * listed as removed, and the screen tells the admin that a proposal which
   * changed two boundaries changed all forty. That is the one job this
   * component has. Rounding both sides to the millisecond before keying, or
   * comparing numerically with an epsilon, would fix it.
   */
  it("calls an unchanged boundary new when it is a float-width apart", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 0.3, text: "same line" })],
      // 0.1 + 0.2 is 0.30000000000000004.
      suggested: [aSegment({ start: 0, end: 0.1 + 0.2, text: "same line" })],
    });
    expect(container.querySelector(".border-green-500")).toBeInTheDocument();
    expect(container.querySelector(".line-through")).toBeInTheDocument();
    // And both readouts round to the same displayed time, so the screen gives
    // the admin no way to see why.
    expect(screen.getAllByText("0.0s – 0.3s")).toHaveLength(2);
  });
});

describe("DiffPreview — what each row shows", () => {
  it("shows the line's timings to a tenth", () => {
    renderDiff({ suggested: [aSegment({ start: 12.34, end: 15.67 })] });
    expect(screen.getByText("12.3s – 15.7s")).toBeInTheDocument();
  });

  it("shows the Arabic", () => {
    renderDiff({ suggested: [aSegment({ text: "كيف حالك" })] });
    expect(screen.getByText("كيف حالك")).toBeInTheDocument();
  });

  it("shows the translation when there is one", () => {
    renderDiff({ suggested: [aSegment({ translation: "How are you" })] });
    expect(screen.getByText("How are you")).toBeInTheDocument();
  });

  it("leaves the translation line out when there is none", () => {
    renderDiff({ suggested: [aSegment({ translation: "" })] });
    expect(screen.getByText("مرحبا")).toBeInTheDocument();
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
  });

  it("names the speaker when the model identified one", () => {
    // Speaker change detection is half the reason to re-segment, so who is
    // talking is the thing an admin checks the split against.
    renderDiff({ suggested: [aSegment({ speaker: "A" } as Partial<Segment>)] });
    expect(screen.getByText("Speaker A")).toBeInTheDocument();
  });

  it("leaves the badge off when it did not", () => {
    renderDiff({ suggested: [aSegment()] });
    expect(screen.queryByText(/^Speaker /)).not.toBeInTheDocument();
  });

  it("lays the Arabic out right-to-left and the timings left-to-right", () => {
    const { container } = renderDiff({ suggested: [aSegment({ start: 1, end: 2 })] });
    const row = container.querySelector("[dir='rtl']")!;
    expect(row).toBeInTheDocument();
    expect(screen.getByText("1.0s – 2.0s").closest("[dir='ltr']")).toBeInTheDocument();
  });
});

describe("DiffPreview — accepting and rejecting", () => {
  const split = {
    original: [aSegment({ start: 0, end: 2, text: "one long line" })],
    suggested: [
      aSegment({ start: 0, end: 1, text: "first" }),
      aSegment({ start: 1, end: 2, text: "second" }),
    ],
  };

  it("offers to take the whole proposal", () => {
    const { onAcceptAll } = renderDiff(split);
    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it("offers to throw the whole proposal away", () => {
    const { onRejectAll } = renderDiff(split);
    fireEvent.click(screen.getByRole("button", { name: "Reject All" }));
    expect(onRejectAll).toHaveBeenCalledTimes(1);
  });

  it("offers a decision on each new line", () => {
    renderDiff(split);
    expect(screen.getAllByRole("button", { name: "✓" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "✗" })).toHaveLength(2);
  });

  it("accepts the line whose button was pressed", () => {
    const { onAcceptOne } = renderDiff(split);
    fireEvent.click(acceptRow(1));
    expect(onAcceptOne).toHaveBeenCalledWith(1);
  });

  it("rejects the line whose button was pressed", () => {
    const { onRejectOne } = renderDiff(split);
    fireEvent.click(rejectRow(0));
    expect(onRejectOne).toHaveBeenCalledWith(0);
  });

  it("indexes by position in the proposal, counting unchanged lines", () => {
    // The caller applies the decision against `suggested`, so the index has to
    // be that array's, not a count of the changed rows.
    const { onAcceptOne } = renderDiff({
      original: [aSegment({ start: 0, end: 1, text: "kept" })],
      suggested: [
        aSegment({ start: 0, end: 1, text: "kept" }),
        aSegment({ start: 1, end: 2, text: "new" }),
      ],
    });
    fireEvent.click(acceptRow(0));
    expect(onAcceptOne).toHaveBeenCalledWith(1);
  });

  it("offers no per-line decision on an unchanged line", () => {
    renderDiff({
      original: [aSegment({ start: 0, end: 1 })],
      suggested: [aSegment({ start: 0, end: 1 })],
    });
    expect(screen.queryByRole("button", { name: "✓" })).not.toBeInTheDocument();
  });

  /**
   * FINDING — a boundary the proposal deletes cannot be kept on its own.
   *
   * Removed lines are rendered struck through with no buttons beside them, so
   * the only way to hold on to one is Reject All. An admin who likes
   * nineteen of twenty changes but wants to keep one boundary the model merged
   * away has to reject the lot and redo the split by hand.
   */
  it("gives a removed line no way back", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 1, text: "merged away" }), aSegment({ start: 1, end: 3 })],
      suggested: [aSegment({ start: 0, end: 3, text: "one line now" })],
    });
    const removed = container.querySelector(".line-through")!;
    expect(removed).toHaveTextContent("merged away");
    expect(removed.querySelector("button")).toBeNull();
  });
});
