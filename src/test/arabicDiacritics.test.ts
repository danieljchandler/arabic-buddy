import { describe, it, expect } from "vitest";
import {
  hasDiacritics,
  normalizeArabicForMatch,
  overlayDiacritizedLines,
  overlayLineByWord,
  stripDiacritics,
} from "../../supabase/functions/_shared/arabicDiacritics";

describe("stripDiacritics / hasDiacritics", () => {
  it("removes tashkeel but keeps the letters", () => {
    expect(stripDiacritics("أَنَا رَايِح")).toBe("أنا رايح");
  });

  it("removes shadda, tanwin and the dagger alif", () => {
    expect(stripDiacritics("السُّوق")).toBe("السوق");
    expect(stripDiacritics("كِتَابًا")).toBe("كتابا");
    expect(stripDiacritics("هَٰذَا")).toBe("هذا");
  });

  it("detects whether a word is voweled at all", () => {
    expect(hasDiacritics("رَايِح")).toBe(true);
    expect(hasDiacritics("رايح")).toBe(false);
  });
});

describe("normalizeArabicForMatch", () => {
  it("collapses hamza carriers to bare alef — the normalisation Farasa applies", () => {
    expect(normalizeArabicForMatch("أَنَا")).toBe(normalizeArabicForMatch("انَا"));
    expect(normalizeArabicForMatch("إلى")).toBe(normalizeArabicForMatch("الى"));
    expect(normalizeArabicForMatch("آسف")).toBe(normalizeArabicForMatch("اسف"));
  });

  it("ignores tatweel and edge punctuation", () => {
    expect(normalizeArabicForMatch("رايـــح")).toBe(normalizeArabicForMatch("رايح"));
    expect(normalizeArabicForMatch("رايح،")).toBe(normalizeArabicForMatch("رايح"));
    expect(normalizeArabicForMatch("«السوق»")).toBe(normalizeArabicForMatch("السوق"));
  });

  it("still separates genuinely different words", () => {
    expect(normalizeArabicForMatch("بيت")).not.toBe(normalizeArabicForMatch("بنت"));
    expect(normalizeArabicForMatch("كتب")).not.toBe(normalizeArabicForMatch("كتاب"));
  });

  it("returns empty for punctuation-only tokens so they never match", () => {
    expect(normalizeArabicForMatch("،")).toBe("");
  });
});

describe("overlayLineByWord", () => {
  it("fills tashkeel onto unvoweled words", () => {
    const r = overlayLineByWord("انا رايح السوق", "أَنَا رَايِح السُّوق");
    expect(r.matched).toBe(3);
    expect(r.filled).toBe(3);
  });

  it("matches across hamza normalisation — the case that used to be skipped", () => {
    // Original keeps the LLM's hamza spelling; Farasa returns it normalised.
    const r = overlayLineByWord("أنا إلى السوق", "انَا الَى السُّوق");
    expect(r.matched).toBe(3);
  });

  it("keeps our spelling but takes the diacritizer's marks", () => {
    // Original wrote the hamza; Farasa returned bare alef with a fatha.
    // The letters are ours, the vowels are its.
    const r = overlayLineByWord("أنا", "انَا");
    expect(stripDiacritics(r.line)).toBe("أنا");
    expect(hasDiacritics(r.line)).toBe(true);
    expect(r.filled).toBe(1);
  });

  it("never overwrites dialect tashkeel the pipeline already produced", () => {
    // Call 1 is required to emit dialect-accurate vowels; Farasa is MSA-only.
    const r = overlayLineByWord("رَايِح", "رَائِحٌ");
    expect(r.line).toBe("رَايِح");
    expect(r.filled).toBe(0);
  });

  it("recovers position after an unmatched word instead of desyncing", () => {
    // "xxxx" is nowhere in the diacritized side; the words after it must still land.
    const r = overlayLineByWord("انا xxxx السوق", "أَنَا يَلا السُّوق");
    expect(r.line.split(" ")[2]).toBe("السُّوق");
    expect(r.matched).toBe(2);
  });
});

describe("overlayDiacritizedLines", () => {
  const lines = ["انا رايح السوق", "وش تبي منه"];

  it("returns the lines untouched when there is no diacritized text", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const r = overlayDiacritizedLines(lines, empty);
      expect(r.lines).toEqual(lines);
      expect(r.strategy).toBe("none");
      expect(r.filled).toBe(0);
    }
  });

  it("uses the per-line path when newlines survived", () => {
    const r = overlayDiacritizedLines(lines, "أَنَا رَايِح السُّوق\nوِش تَبِي مِنه");
    expect(r.strategy).toBe("per-line");
    expect(r.matched).toBe(6);
    expect(r.filled).toBe(6);
    expect(r.lines[0]).toContain("رَايِح");
  });

  it("falls back to one word stream when the diacritizer returns a single blob", () => {
    // This is the shape Farasa actually returns, and the path that used to
    // produce zero matches for the whole transcript.
    const r = overlayDiacritizedLines(lines, "أَنَا رَايِح السُّوق وِش تَبِي مِنه");
    expect(r.strategy).toBe("word-stream");
    expect(r.matched).toBe(6);
    expect(r.filled).toBe(6);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]).toContain("تَبِي");
  });

  it("keeps the line count and word order no matter which path runs", () => {
    const r = overlayDiacritizedLines(lines, "أَنَا رَايِح السُّوق وِش تَبِي مِنه");
    expect(r.lines.map((l) => l.split(" ").length)).toEqual([3, 3]);
    expect(stripDiacritics(r.lines.join(" "))).toBe(lines.join(" "));
  });

  it("survives a diacritizer that dropped words mid-stream", () => {
    // Farasa returned 246 chars for a longer input in the reported run.
    const r = overlayDiacritizedLines(lines, "أَنَا رَايِح السُّوق مِنه");
    expect(r.lines).toHaveLength(2);
    // The words it did return are still applied.
    expect(r.matched).toBeGreaterThanOrEqual(3);
    expect(r.filled).toBeGreaterThanOrEqual(3);
  });

  it("counts every word so provenance can distinguish broken from unnecessary", () => {
    // Fully voweled input: nothing to fill, but everything still matches.
    const voweled = ["أَنَا رَايِح"];
    const r = overlayDiacritizedLines(voweled, "أَنَا رَايِح");
    expect(r.total).toBe(2);
    expect(r.matched).toBe(2);
    expect(r.filled).toBe(0);
  });

  it("reports zero matches only when the text genuinely does not correspond", () => {
    const r = overlayDiacritizedLines(["انا رايح"], "كِتَاب جَدِيد");
    expect(r.matched).toBe(0);
    expect(r.lines).toEqual(["انا رايح"]);
  });
});
