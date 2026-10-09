import { describe, expect, it } from "vitest";
import { normalizeArabicWord } from "./arabicWord";
import { buildChoices, pickDistractors, seededShuffle } from "./quizDistractors";

/**
 * Options for a choice question. Two things hold: the same card gives the
 * same options every time (so nothing moves under the learner and a test can
 * find the answer), and no option is the answer, or another option, in
 * another spelling.
 */

describe("seeded shuffling", () => {
  it("is deterministic for a seed and different across seeds", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(seededShuffle(items, "card-1")).toEqual(seededShuffle(items, "card-1"));
    const orders = new Set(["card-1", "card-2", "card-3", "card-4"].map((s) => seededShuffle(items, s).join("")));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("keeps every item and leaves the input alone", () => {
    const items = ["a", "b", "c"];
    const out = seededShuffle(items, "x");
    expect([...out].sort()).toEqual(["a", "b", "c"]);
    expect(items).toEqual(["a", "b", "c"]);
  });
});

describe("picking distractors", () => {
  it("never offers the answer, in any spelling", () => {
    const picks = pickDistractors(["بَيْت", "مدرسة", "مطعم", "سوق"], "بيت", "seed", 3, normalizeArabicWord);
    expect(picks).not.toContain("بَيْت");
    expect(picks).toHaveLength(3);
  });

  it("never offers the same word twice", () => {
    const picks = pickDistractors(["house", "House", "house ", "car", "tree"], "dog", "seed");
    expect(picks.map((p) => p.trim().toLowerCase())).toEqual([...new Set(picks.map((p) => p.trim().toLowerCase()))]);
    expect(picks).toHaveLength(3);
  });

  it("skips empty strings and stops at what the pool can give", () => {
    expect(pickDistractors(["", "one", ""], "two", "seed")).toEqual(["one"]);
  });
});

describe("building choices", () => {
  it("includes the answer once among the right number of options", () => {
    const choices = buildChoices("dog", ["cat", "cow", "hen", "fox", "dog"], "card-9");
    expect(choices).toHaveLength(4);
    expect(choices.filter((c) => c === "dog")).toHaveLength(1);
  });

  it("puts the answer in the same place for the same card", () => {
    const pool = ["cat", "cow", "hen", "fox"];
    expect(buildChoices("dog", pool, "card-9")).toEqual(buildChoices("dog", pool, "card-9"));
  });

  it("does not always put the answer first", () => {
    const pool = ["cat", "cow", "hen", "fox"];
    const positions = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => buildChoices("dog", pool, seed).indexOf("dog")),
    );
    expect(positions.size).toBeGreaterThan(1);
  });

  it("offers fewer options rather than padding with nonsense", () => {
    expect(buildChoices("dog", ["cat"], "seed")).toHaveLength(2);
  });
});
