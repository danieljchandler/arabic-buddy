import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptLine } from "@/types/transcript";
import {
  DRAFT_MAX_AGE_MS,
  canonicalLines,
  clearDraft,
  draftKey,
  formatDraftTime,
  linesEqual,
  readDraft,
  writeDraft,
} from "./transcriptDraft";

/**
 * The local copy of an unpublished transcript.
 *
 * A correction pass is an hour of detailed work that lived only in one page's
 * React state, so a closed tab took the lot. The rules that matter here are all
 * about not making that worse: a draft is never confused with a publish, never
 * handed to the wrong video, and never trusted when it cannot be parsed.
 */

const aLine = (over: Partial<TranscriptLine> = {}): TranscriptLine => ({
  id: "line-1",
  arabic: "شلونك اليوم",
  translation: "how are you today",
  tokens: [
    { id: "t1", surface: "شلونك" },
    { id: "t2", surface: "اليوم" },
  ],
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("comparing transcripts", () => {
  it("ignores the order the keys happen to be in", () => {
    const fromServer = JSON.parse('{"translation":"hi","arabic":"مرحبا","id":"a","tokens":[]}');
    const fromEditor = JSON.parse('{"id":"a","arabic":"مرحبا","tokens":[],"translation":"hi"}');

    // A row that came back from Postgres jsonb and the same row rebuilt by the
    // editor do not serialise identically. Comparing raw JSON would put an
    // "unpublished changes" warning on a page nobody had touched, which trains
    // reviewers to ignore the one warning that matters.
    expect(linesEqual([fromServer], [fromEditor])).toBe(true);
  });

  it("sees a corrected word", () => {
    expect(linesEqual([aLine()], [aLine({ arabic: "شخبارك اليوم" })])).toBe(false);
  });

  it("sees a changed token under an unchanged sentence", () => {
    const glossed = aLine({
      tokens: [
        { id: "t1", surface: "شلونك", gloss: "how are you" },
        { id: "t2", surface: "اليوم" },
      ],
    });

    // Glosses are hand-written and are exactly the kind of work worth not
    // losing, even though the Arabic above them reads the same.
    expect(linesEqual([aLine()], [glossed])).toBe(false);
  });

  it("sees a line that was added or removed", () => {
    expect(linesEqual([aLine()], [aLine(), aLine({ id: "line-2" })])).toBe(false);
    expect(linesEqual([], [aLine()])).toBe(false);
  });

  it("treats an absent field and an explicitly undefined one as the same", () => {
    // The editor writes `fusha: undefined` when a correction invalidates it;
    // the stored row simply has no such key.
    expect(canonicalLines([aLine({ fusha: undefined })])).toBe(canonicalLines([aLine()]));
  });
});

describe("storing a draft", () => {
  it("round-trips the lines it was given", () => {
    writeDraft("vid-1", [aLine()], 1_700_000_000_000);

    expect(readDraft("vid-1", 1_700_000_000_000)).toEqual({
      videoId: "vid-1",
      savedAt: 1_700_000_000_000,
      lines: [aLine()],
    });
  });

  it("keeps each video's draft to itself", () => {
    writeDraft("vid-1", [aLine()]);

    // The key carries the video id and the payload repeats it, so a stale key
    // cannot put one video's Arabic into another's editor.
    expect(readDraft("vid-2")).toBeNull();
    expect(localStorage.getItem(draftKey("vid-1"))).toBeTruthy();
  });

  it("reports a browser that refuses to store rather than pretending it worked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    // Transcripts run to hundreds of lines with per-word tokens, so a full quota
    // is a real outcome, and so is private browsing. A safety net nobody is told
    // has failed is worse than no safety net.
    expect(writeDraft("vid-1", [aLine()])).toBeNull();
  });

  it("returns nothing for a video with no draft", () => {
    expect(readDraft("vid-1")).toBeNull();
  });

  it("throws away a draft older than a month", () => {
    const written = writeDraft("vid-1", [aLine()], 1_000)!;

    expect(readDraft("vid-1", written.savedAt + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    // And does not leave it behind to be re-checked forever.
    expect(localStorage.getItem(draftKey("vid-1"))).toBeNull();
  });

  it("keeps a draft that is still within the window", () => {
    writeDraft("vid-1", [aLine()], 1_000);

    expect(readDraft("vid-1", 1_000 + DRAFT_MAX_AGE_MS - 1)).not.toBeNull();
  });

  it("discards a draft it cannot make sense of", () => {
    localStorage.setItem(draftKey("vid-1"), "{not json");
    expect(readDraft("vid-1")).toBeNull();

    localStorage.setItem(draftKey("vid-1"), JSON.stringify({ videoId: "vid-1", lines: "nope" }));
    expect(readDraft("vid-1")).toBeNull();
  });

  it("discards a draft stored under the wrong video", () => {
    localStorage.setItem(
      draftKey("vid-1"),
      JSON.stringify({ videoId: "vid-9", savedAt: Date.now(), lines: [aLine()] }),
    );

    expect(readDraft("vid-1")).toBeNull();
  });

  it("clears on request", () => {
    writeDraft("vid-1", [aLine()]);
    clearDraft("vid-1");

    expect(readDraft("vid-1")).toBeNull();
  });

  it("does nothing at all without a video id", () => {
    expect(writeDraft("", [aLine()])).toBeNull();
    expect(readDraft("")).toBeNull();
    expect(() => clearDraft("")).not.toThrow();
  });
});

describe("formatDraftTime", () => {
  it("gives a wall-clock time", () => {
    const at = new Date(2026, 0, 5, 14, 32).getTime();

    // "is this the work I remember doing?" is answered by the clock on the
    // afternoon it happened, not by "3 hours ago".
    expect(formatDraftTime(at)).toBe(
      new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
    expect(formatDraftTime(at)).toMatch(/\d/);
  });
});
