import { describe, it, expect } from "vitest";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";

// A short, ordinary, fully vocalized Gulf passage of the kind reading-passage
// asks the model for. Nothing here is a dialect failure.
const GULF_PASSAGE = [
  "رُحْتُ السُّوق هٰذَا الصُّبْح مَعَ رِفِيجِي.",
  "شِرِينَا خُضَار وَفَوَاكِه طَازَجَة.",
  "هٰذِه أَوَّل مَرَّة أَرُوح لِهٰذَا السُّوق.",
  "عِنْدَمَا وِصَلْنَا كَان الزِّحَام وَاجِد.",
].join(" ");

describe("detectMsaLeaks", () => {
  // This passage used to report three leaks — هذا, هذه, عندما — all of them
  // ordinary Gulf. Every generated passage therefore tripped the detector and
  // paid for a rewrite pass that could never clear them, because the model kept
  // writing the same words: they were never wrong. That was the bulk of the
  // reading-practice latency.
  it("does not flag ordinary Gulf demonstratives", () => {
    const result = detectMsaLeaks(GULF_PASSAGE, "Gulf");
    expect(result.leaks).toEqual([]);
    expect(result.severity).toBe("none");
  });

  it("still flags them for Egyptian, where ده/دي is the norm", () => {
    const result = detectMsaLeaks("هَذَا الْبَيْت كِبِير", "Egyptian");
    expect(result.leaks).toContain("هذا");
  });

  it("catches genuine cross-dialect drift in Gulf", () => {
    // Egyptian-only forms have no business in a Gulf passage.
    const result = detectMsaLeaks("أَنَا عَايِز أَرُوح دِلْوَقْتِي", "Gulf");
    expect(result.leaks).toEqual(expect.arrayContaining(["عايز", "دلوقتي"]));
  });

  it("still catches unambiguous MSA in Gulf", () => {
    const result = detectMsaLeaks("سَوْفَ أَذْهَبُ إِلَى الْبَيْتِ الَّذِي هُنَاك", "Gulf");
    expect(result.leaks).toEqual(expect.arrayContaining(["سوف"]));
  });

  it("matches whole words only, not substrings", () => {
    // هذاك is a Gulf demonstrative in its own right; it must not match هذا.
    const result = detectMsaLeaks("شِفْت هَذَاكْ الرِّيَال", "Egyptian");
    expect(result.leaks).not.toContain("هذا");
  });

  it("reports nothing for empty input", () => {
    expect(detectMsaLeaks("", "Gulf")).toEqual({ leaks: [], severity: "none" });
  });
});
