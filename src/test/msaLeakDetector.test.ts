import { describe, it, expect } from "vitest";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";

// A short, ordinary, fully vocalized Gulf passage of the kind reading-passage
// asks the model for. Nothing here is a dialect failure.
const GULF_PASSAGE = [
  "رُحْتُ السُّوق هٰذَا الصُّبْح مَعَ رِفِيجِي.",
  "شِرِينَا خُضَار وَفَوَاكِه طَازَجَة.",
  "هٰذِه أَوَّل مَرَّة أَرُوح لِهٰذَا السُّوق.",
].join(" ");

describe("detectMsaLeaks false positives", () => {
  // This is the behaviour that made reading-passage slow: the universal leak
  // list contains demonstratives that ordinary Gulf prose uses freely, so
  // `leaks.length > 0` was true on nearly every generated passage.
  //
  // aiBrain therefore must NOT treat a non-empty leak set as grounds for a full
  // critic rewrite — leaks route to the targeted repair pass instead, and a
  // rewrite that leaves the same tokens in place is not retried. If this test
  // ever starts passing with zero leaks (because the detector was tuned), that
  // policy can be revisited; until then it documents why the policy exists.
  it("flags ordinary Gulf demonstratives, so leaks alone cannot gate a rewrite", () => {
    const result = detectMsaLeaks(GULF_PASSAGE, "Gulf");
    expect(result.leaks).toContain("هذا");
    expect(result.leaks.length).toBeGreaterThan(0);
  });

  it("still catches genuine cross-dialect drift", () => {
    // Egyptian-only forms have no business in a Gulf passage.
    const result = detectMsaLeaks("أَنَا عَايِز أَرُوح دِلْوَقْتِي", "Gulf");
    expect(result.leaks).toEqual(expect.arrayContaining(["عايز", "دلوقتي"]));
  });

  it("reports nothing for empty input", () => {
    expect(detectMsaLeaks("", "Gulf")).toEqual({ leaks: [], severity: "none" });
  });
});
