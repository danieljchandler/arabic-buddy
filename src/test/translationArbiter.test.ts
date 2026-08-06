import { describe, it, expect } from "vitest";
import {
  ARBITER_MIN_MARGIN,
  ARBITER_MIN_SCORE,
  arbitrateDispute,
  jaccard,
  normalizeForCompare,
  type ArbiterCandidate,
} from "../../supabase/functions/_shared/translationArbiter";

const cand = (name: string, text: string, weight = 1, literal = ""): ArbiterCandidate =>
  ({ name, text, weight, literal });

describe("normalizeForCompare", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeForCompare("  The  CAT—sat, (down)!  ")).toBe("the cat sat down");
  });

  it("tolerates null-ish input", () => {
    expect(normalizeForCompare("")).toBe("");
  });
});

describe("jaccard", () => {
  it("is 1 for identical token sets regardless of punctuation and case", () => {
    expect(jaccard("The cat sat.", "the CAT sat")).toBe(1);
  });

  it("is 0 for disjoint token sets", () => {
    expect(jaccard("alpha beta", "gamma delta")).toBe(0);
  });

  it("is 1 when both sides are empty", () => {
    expect(jaccard("", "")).toBe(1);
  });

  it("is 0 when only one side is empty", () => {
    expect(jaccard("", "something")).toBe(0);
  });

  it("scores partial overlap by intersection over union", () => {
    // {a,b,c} vs {b,c,d} → 2 shared of 4 distinct
    expect(jaccard("a b c", "b c d")).toBeCloseTo(0.5, 5);
  });
});

describe("arbitrateDispute", () => {
  it("picks the candidate the arbiter clearly backs", () => {
    const verdict = arbitrateDispute("he went to the market yesterday", [
      cand("claude", "he went to the market yesterday"),
      cand("qwen", "she cooked dinner for her family"),
    ]);
    expect(verdict.winner?.name).toBe("claude");
    expect(verdict.score).toBe(1);
  });

  it("carries the winner's literal gloss through", () => {
    const verdict = arbitrateDispute("the boy ate bread", [
      cand("claude", "the boy ate bread", 1, "boy the ate bread"),
      cand("qwen", "nothing similar whatsoever here"),
    ]);
    expect(verdict.winner?.literal).toBe("boy the ate bread");
  });

  it("refuses to choose when two candidates are equally close", () => {
    const verdict = arbitrateDispute("the cat sat on the mat", [
      cand("claude", "the cat sat on the mat"),
      cand("gemini", "the cat sat on the mat"),
    ]);
    expect(verdict.winner).toBeNull();
    expect(verdict.reason).toBe("too_close");
  });

  it("refuses to choose when nothing is close enough", () => {
    const verdict = arbitrateDispute("completely unrelated wording", [
      cand("claude", "the cat sat down"),
      cand("qwen", "a dog barked loudly"),
    ]);
    expect(verdict.winner).toBeNull();
    expect(verdict.reason).toBe("below_threshold");
    expect(verdict.score).toBeLessThan(ARBITER_MIN_SCORE);
  });

  it("reports when the arbiter said nothing", () => {
    expect(arbitrateDispute("", [cand("claude", "anything")]).reason).toBe("no_arbiter_text");
    expect(arbitrateDispute("   ", [cand("claude", "anything")]).reason).toBe("no_arbiter_text");
    expect(arbitrateDispute(null, [cand("claude", "anything")]).reason).toBe("no_arbiter_text");
  });

  it("reports when there is nothing to arbitrate between", () => {
    expect(arbitrateDispute("a rendering", []).reason).toBe("no_candidates");
    expect(arbitrateDispute("a rendering", [cand("claude", "  ")]).reason).toBe("no_candidates");
  });

  it("can settle a line against a single candidate, with no runner-up", () => {
    const verdict = arbitrateDispute("he sells fish at the souq", [
      cand("claude", "he sells fish at the souq"),
    ]);
    expect(verdict.winner?.name).toBe("claude");
    expect(verdict.margin).toBe(verdict.score);
  });

  it("leaves a lone candidate alone when the arbiter disagrees with it", () => {
    const verdict = arbitrateDispute("he sells fish at the souq", [
      cand("qwen", "the weather turned cold overnight"),
    ]);
    expect(verdict.winner).toBeNull();
    expect(verdict.reason).toBe("below_threshold");
  });

  it("honours caller-supplied thresholds", () => {
    // 0.909 vs 0.833 — both plainly on topic, neither clearly nearer.
    const arbiter = "a b c d e f g h i j";
    const candidates = [
      cand("claude", "a b c d e f g h i j k"),
      cand("qwen", "a b c d e f g h i j k l"),
    ];
    const strict = arbitrateDispute(arbiter, candidates);
    expect(strict.winner).toBeNull();
    expect(strict.reason).toBe("too_close");
    expect(strict.margin).toBeLessThan(ARBITER_MIN_MARGIN);
    // A permissive margin lets the closer one through.
    expect(
      arbitrateDispute(arbiter, candidates, { minMargin: 0 }).winner?.name,
    ).toBe("claude");
  });

  it("breaks exact score ties toward the higher-weight model before margin applies", () => {
    const verdict = arbitrateDispute("a b c", [
      cand("qwen", "a b c", 0.5),
      cand("claude", "a b c", 1),
    ], { minMargin: 0 });
    expect(verdict.winner?.name).toBe("claude");
  });

  it("exposes thresholds that keep arbitration stricter than a coin flip", () => {
    expect(ARBITER_MIN_SCORE).toBeGreaterThan(0);
    expect(ARBITER_MIN_MARGIN).toBeGreaterThan(0);
  });
});
