import { describe, expect, it } from "vitest";
import { buildCTest, completionMatches, MIN_GAP_WORD_LENGTH, scoreCTest, TARGET_GAPS } from "./cTest";

/**
 * The instrument's construction and scoring. What must hold: the first
 * sentence is context and never gapped; from then on every second word of
 * three or more letters loses its second half; scoring forgives what a
 * speaker cannot hear and nothing else.
 */

const LINES = [
  "أَنا رُحْت السُّوق أَمْس مَع صَديقي",             // intact
  "اشْتَرَيْنا خُضار وَفَواكِه وَقَهْوَة مِن الدُّكان",  // gaps start here
  "بَعْدين قَعَدْنا في مَقْهى صَغير قَريب مِن البَيْت",
];

describe("buildCTest", () => {
  const test = buildCTest(LINES);

  it("leaves the first sentence intact and strips tashkeel for display", () => {
    const firstLineWords = "انا رحت السوق امس مع صديقي".split(" ").length;
    expect(test.items.every((i) => i.index >= firstLineWords)).toBe(true);
    expect(test.words[0]).toBe("أنا");
  });

  it("gaps every second eligible word from the second sentence, keeping the first half", () => {
    const first = test.items[0];
    expect(first.word).toBe("اشترينا");
    expect(first.stem).toBe("اشتر");
    expect(first.answer).toBe("ينا");
    expect(first.stem + first.answer).toBe(first.word);
    // The next eligible word is skipped, the one after is gapped.
    expect(test.items[1].word).toBe("وفواكه");
  });

  it("never gaps a word shorter than the floor", () => {
    for (const item of test.items) expect(item.word.length).toBeGreaterThanOrEqual(MIN_GAP_WORD_LENGTH);
    expect(test.items.some((i) => i.word === "من" || i.word === "في")).toBe(false);
  });

  it("stops gapping at the cap and leaves the rest whole", () => {
    const long = [LINES[0], ...Array.from({ length: 30 }, () => LINES[1])];
    const capped = buildCTest(long);
    expect(capped.items).toHaveLength(TARGET_GAPS);
    expect(capped.words.length).toBeGreaterThan(TARGET_GAPS * 2);
    expect(buildCTest(long, { maxGaps: 5 }).items).toHaveLength(5);
  });

  it("is empty for an empty passage", () => {
    expect(buildCTest([])).toEqual({ words: [], items: [] });
  });
});

describe("scoring", () => {
  const test = buildCTest(LINES);

  it("matches the exact completion and the variants a speaker cannot hear", () => {
    const item = test.items[0]; // اشتر + ينا
    expect(completionMatches(item, "ينا")).toBe(true);
    expect(completionMatches(item, "يْنَا")).toBe(true);
    expect(completionMatches(item, " ينا ")).toBe(true);
    expect(completionMatches(item, "")).toBe(false);
    expect(completionMatches(item, "وا")).toBe(false);
  });

  it("scores per item and as a percentage", () => {
    const answers = test.items.map((i, k) => (k % 2 === 0 ? i.answer : "xx"));
    const s = scoreCTest(test, answers);
    expect(s.total).toBe(test.items.length);
    expect(s.correct).toBe(Math.ceil(test.items.length / 2));
    expect(s.percent).toBe(Math.round((s.correct / s.total) * 100));
    expect(s.results[0]).toBe(true);
    expect(s.results[1]).toBe(false);
  });

  it("is zero, not NaN, with no items", () => {
    expect(scoreCTest(buildCTest([]), [])).toEqual({ correct: 0, total: 0, percent: 0, results: [] });
  });
});
