import { describe, expect, it } from "vitest";
import { screenTextFor, splitTranscriptLines } from "./onScreenText";

/**
 * What a video shows, kept apart from what it says.
 *
 * The pipeline used to append every overlay it read to `transcript_lines`,
 * which made a POV caption indistinguishable from a spoken sentence: the player
 * tried to seek to audio that was never recorded, shadowing offered a recording
 * of silence, and the tutor answered "what did they say" with text nobody said.
 * Overlays now live in `visual_timeline`, but the library is full of rows from
 * before that change, so both shapes have to read the same way.
 */

const spoken = (id: string) => ({ id, arabic: "شلونك اليوم", translation: "How are you today" });

describe("splitTranscriptLines", () => {
  it("keeps the spoken lines and pulls the overlays out", () => {
    const { spoken: said, onScreen } = splitTranscriptLines([
      spoken("a"),
      { id: "b", arabic: "POV: تروح الدوام", source: "on_screen" },
      spoken("c"),
    ]);

    expect(said.map((l) => l.id)).toEqual(["a", "c"]);
    expect(onScreen.map((l) => l.id)).toEqual(["b"]);
  });

  it("recognises the marker the analyzer wrote as well as the pipeline's", () => {
    // Two code paths tagged these, and rows exist carrying either one.
    const { onScreen } = splitTranscriptLines([
      { id: "a", arabic: "x", segmentType: "text_overlay" },
      { id: "b", arabic: "y", source: "on_screen" },
    ]);

    expect(onScreen).toHaveLength(2);
  });

  it("survives a row with no transcript at all", () => {
    expect(splitTranscriptLines(null)).toEqual({ spoken: [], onScreen: [] });
    expect(splitTranscriptLines(undefined as never)).toEqual({ spoken: [], onScreen: [] });
  });
});

describe("screenTextFor", () => {
  it("reads the timeline column", () => {
    const lines = screenTextFor({
      visual_timeline: [
        { startSeconds: 0, endSeconds: 3, text: "لما تصحى بدري", translation: "when you wake up early" },
      ],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("لما تصحى بدري");
    expect(lines[0].translation).toBe("when you wake up early");
    expect(lines[0].startSeconds).toBe(0);
  });

  it("falls back to overlays an older run left in the transcript", () => {
    const lines = screenTextFor({
      visual_timeline: [],
      transcript_lines: [
        spoken("a"),
        {
          id: "b",
          arabic: "POV: تروح الدوام",
          translation: "POV: you go to work",
          startMs: 2000,
          endMs: 5000,
          source: "on_screen",
        },
      ],
    });

    // These rows predate `visual_timeline`, so the transcript is the only copy
    // of that caption — reading only the column would show the learner nothing.
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("POV: تروح الدوام");
    expect(lines[0].startSeconds).toBe(2);
    expect(lines[0].endSeconds).toBe(5);
  });

  it("does not show the same caption twice", () => {
    const lines = screenTextFor({
      visual_timeline: [{ startSeconds: 0, text: "لما تصحى بدري" }],
      transcript_lines: [{ id: "b", arabic: "لما تصحى بدري", source: "on_screen" }],
    });

    // Once a video has been through the current pipeline the column is
    // authoritative; reading both would duplicate every overlay.
    expect(lines).toHaveLength(1);
  });

  it("marks a caption the model could barely read", () => {
    const [line] = screenTextFor({
      visual_timeline: [{ startSeconds: 0, text: "؟؟؟ بدري", confidence: "low" }],
    });

    expect(line.confidence).toBe("low");
  });

  it("ignores a timeline entry that is only a scene description", () => {
    // A moment with no text has nothing to show a learner reading captions.
    expect(screenTextFor({ visual_timeline: [{ startSeconds: 0, scene: "Two men in a car." }] })).toEqual([]);
  });

  it("returns nothing for a video with neither", () => {
    expect(screenTextFor({})).toEqual([]);
    expect(screenTextFor(null)).toEqual([]);
    expect(screenTextFor({ visual_timeline: "not an array", transcript_lines: null })).toEqual([]);
  });

  it("splits an overlay into tappable words", () => {
    // The vision pass reads a caption as a picture, not as parsed words, so
    // there is no per-word gloss to carry over — only the split itself.
    const [line] = screenTextFor({
      visual_timeline: [{ startSeconds: 0, text: "لما تصحى بدري", translation: "when you wake up early" }],
    });

    expect(line.tokens.map((t) => t.surface)).toEqual(["لما", "تصحى", "بدري"]);
    expect(line.tokens.every((t) => t.gloss === undefined)).toBe(true);
  });

  it("gives every token in a video a distinct id", () => {
    const [first, second] = screenTextFor({
      visual_timeline: [
        { startSeconds: 0, text: "لما تصحى" },
        { startSeconds: 5, text: "لما تصحى" },
      ],
    });

    // Two overlays can carry the same text; their tokens must not collide,
    // or tapping a word in one line would key off the other's saved state.
    const firstIds = first.tokens.map((t) => t.id);
    const secondIds = second.tokens.map((t) => t.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
  });

  it("tokenizes a caption recovered from the legacy transcript too", () => {
    const [line] = screenTextFor({
      visual_timeline: [],
      transcript_lines: [{ id: "b", arabic: "POV: تروح الدوام", source: "on_screen" }],
    });

    expect(line.tokens.map((t) => t.surface)).toEqual(["POV:", "تروح", "الدوام"]);
  });
});
