import { describe, expect, it } from "vitest";
import {
  momentsAt,
  parseVisualTimeline,
  visualContextAt,
  type VisualMoment,
} from "../../supabase/functions/_shared/visualTimelineCore";

/**
 * What is on a video's screen, and when.
 *
 * Half of an Arabic meme is text burned into the frame and never spoken, so a
 * tutor working from subtitles alone is reading one track of a two-track
 * medium. `extract-visual-context` has always read those overlays; what was
 * missing was keeping their timings, so "what does that caption say?" could be
 * answered about the caption actually on screen.
 */

const moment = (over: Partial<VisualMoment> = {}): VisualMoment => ({
  startSeconds: 0,
  endSeconds: 5,
  text: "POV: طالب في الجامعة",
  translation: "POV: a university student",
  ...over,
});

describe("parseVisualTimeline", () => {
  it("reads what the extractor stored", () => {
    const parsed = parseVisualTimeline([
      { startSeconds: 3, endSeconds: 8, text: "يالله", translation: "let's go", confidence: "high" },
    ]);
    expect(parsed).toEqual([
      { startSeconds: 3, endSeconds: 8, text: "يالله", translation: "let's go", scene: undefined, confidence: "high" },
    ]);
  });

  it("sorts by start time so the timeline reads forwards", () => {
    const parsed = parseVisualTimeline([
      { startSeconds: 9, text: "c" },
      { startSeconds: 1, text: "a" },
      { startSeconds: 4, text: "b" },
    ]);
    expect(parsed.map((m) => m.text)).toEqual(["a", "b", "c"]);
  });

  it("drops what it cannot place or cannot use", () => {
    // jsonb written by an earlier version of a vision prompt: tolerate it,
    // don't trust it.
    const parsed = parseVisualTimeline([
      { startSeconds: 1, text: "keep" },
      { text: "no timing" },
      { startSeconds: 2 },
      { startSeconds: 3, text: "   " },
      null,
      "nonsense",
    ]);
    expect(parsed.map((m) => m.text)).toEqual(["keep"]);
  });

  it("accepts snake_case timings as well as camel", () => {
    const parsed = parseVisualTimeline([{ start_seconds: 2, end_seconds: 6, text: "x" }]);
    expect(parsed[0]).toMatchObject({ startSeconds: 2, endSeconds: 6 });
  });

  it("survives anything that is not an array", () => {
    for (const raw of [null, undefined, {}, "", 7]) {
      expect(parseVisualTimeline(raw)).toEqual([]);
    }
  });

  it("ignores a confidence it does not recognise", () => {
    expect(parseVisualTimeline([{ startSeconds: 0, text: "x", confidence: "certain" }])[0].confidence)
      .toBeUndefined();
  });
});

describe("momentsAt", () => {
  const timeline = [
    moment({ startSeconds: 0, endSeconds: 5, text: "first" }),
    moment({ startSeconds: 4, endSeconds: 9, text: "overlapping" }),
    moment({ startSeconds: 20, endSeconds: 24, text: "later" }),
  ];

  it("finds the moment on screen", () => {
    expect(momentsAt(timeline, 2).map((m) => m.text)).toEqual(["first"]);
    expect(momentsAt(timeline, 22).map((m) => m.text)).toEqual(["later"]);
  });

  it("returns every overlapping moment, not just one", () => {
    // Captions and title cards routinely share the screen.
    expect(momentsAt(timeline, 4.5).map((m) => m.text)).toEqual(["first", "overlapping"]);
  });

  it("finds nothing in a gap", () => {
    expect(momentsAt(timeline, 14)).toEqual([]);
  });

  it("gives an open-ended moment a bounded life", () => {
    // The model estimates timings from sampled frames and often omits the end.
    // Open-ended would make the first caption of a video appear to be showing
    // three minutes later; instantaneous would make it invisible.
    const open = [moment({ startSeconds: 10, endSeconds: undefined, text: "no end" })];
    expect(momentsAt(open, 12)).toHaveLength(1);
    expect(momentsAt(open, 30)).toHaveLength(0);
  });

  it("refuses a nonsense time rather than guessing", () => {
    expect(momentsAt(timeline, Number.NaN)).toEqual([]);
  });
});

describe("visualContextAt", () => {
  it("describes the caption on screen, with its translation", () => {
    const text = visualContextAt([moment()], 2);
    expect(text).toContain("POV: طالب في الجامعة");
    expect(text).toContain("POV: a university student");
  });

  it("marks a reading the model was unsure of", () => {
    // Stating a half-legible caption as fact and claiming there is no text at
    // all are both worse than saying which it is.
    const text = visualContextAt([moment({ confidence: "low" })], 2);
    expect(text).toContain("partly legible");
  });

  it("joins what is on screen at once", () => {
    const text = visualContextAt(
      [moment({ startSeconds: 0, endSeconds: 6, text: "a", translation: undefined }), moment({ startSeconds: 1, endSeconds: 6, text: "b", translation: undefined })],
      2,
    );
    expect(text).toBe('on-screen text "a" · on-screen text "b"');
  });

  it("carries the scene description when there is one", () => {
    const text = visualContextAt(
      [moment({ text: undefined, translation: undefined, scene: "Two men in a majlis." })],
      1,
    );
    expect(text).toBe("Two men in a majlis.");
  });

  it("says nothing when there is nothing to say", () => {
    expect(visualContextAt([moment()], 40)).toBeUndefined();
    expect(visualContextAt([], 1)).toBeUndefined();
    // No playback position — a paused video before the first line.
    expect(visualContextAt([moment()], undefined)).toBeUndefined();
  });
});
