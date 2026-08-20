import { describe, expect, it } from "vitest";
import {
  clampMemory,
  EMPTY_MEMORY,
  MAX_OPEN_QUESTIONS,
  MAX_SUMMARY_CHARS,
  memoryBlock,
  parseMemory,
  shouldRewrite,
  TURNS_BETWEEN_REWRITES,
} from "../../supabase/functions/_shared/learnerMemoryCore";

/**
 * What the tutor carries between conversations.
 *
 * Every other piece of learner context is derived from something that actually
 * happened — a review was failed, a video was watched. This one is a model's
 * summary of earlier chats, which makes it the least reliable thing in the
 * prompt and the one that most needs hedging: a tutor that treats it as fact
 * will insist a learner struggles with something they asked about once and got
 * right.
 */

describe("parseMemory", () => {
  it("reads a stored row", () => {
    expect(
      parseMemory({
        summary: "Prefers examples before rules.",
        open_questions: ["why is كان used here?"],
        turns_seen: 12,
      }),
    ).toEqual({
      summary: "Prefers examples before rules.",
      openQuestions: ["why is كان used here?"],
      turnsSeen: 12,
      turnsTotal: 12,
    });
  });

  it("treats a missing row as no memory", () => {
    for (const row of [null, undefined, "nonsense", 3]) {
      expect(parseMemory(row)).toEqual(EMPTY_MEMORY);
    }
  });

  it("caps what it reads back, not just what it writes", () => {
    // The row is written by a model. A ceiling enforced only on write is a
    // ceiling one bug away from not existing.
    const parsed = parseMemory({
      summary: "s".repeat(5000),
      open_questions: Array.from({ length: 50 }, (_, i) => `q${i}`),
      turns_seen: 4,
    });
    expect(parsed.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    expect(parsed.openQuestions).toHaveLength(MAX_OPEN_QUESTIONS);
  });

  it("drops junk in the questions array", () => {
    expect(
      parseMemory({ summary: "x", open_questions: ["real", "", "   ", null, 7] }).openQuestions,
    ).toEqual(["real"]);
  });

  it("refuses a nonsense turn count", () => {
    expect(parseMemory({ summary: "x", turns_seen: Number.NaN }).turnsSeen).toBe(0);
    expect(parseMemory({ summary: "x", turns_seen: "many" }).turnsSeen).toBe(0);
  });
});

describe("clampMemory", () => {
  it("bounds whatever the summarizer produced", () => {
    const clamped = clampMemory(
      {
        summary: `  ${"s".repeat(5000)}  `,
        openQuestions: Array.from({ length: 20 }, (_, i) => `q${i}`),
      },
      9,
    );
    expect(clamped.summary.length).toBe(MAX_SUMMARY_CHARS);
    expect(clamped.openQuestions).toHaveLength(MAX_OPEN_QUESTIONS);
    expect(clamped.turnsSeen).toBe(9);
  });

  it("survives a summarizer that returned nothing usable", () => {
    expect(clampMemory({}, 3)).toEqual({ summary: "", openQuestions: [], turnsSeen: 3, turnsTotal: 3 });
    expect(clampMemory({ summary: 42 as unknown as string }, -5).turnsSeen).toBe(0);
  });
});

describe("shouldRewrite", () => {
  it("waits for enough new turns to be worth a model call", () => {
    const memory = { summary: "x", openQuestions: [], turnsSeen: 10, turnsTotal: 10 };
    expect(shouldRewrite(memory, 10)).toBe(false);
    expect(shouldRewrite(memory, 10 + TURNS_BETWEEN_REWRITES - 1)).toBe(false);
    expect(shouldRewrite(memory, 10 + TURNS_BETWEEN_REWRITES)).toBe(true);
  });

  it("rewrites once a first-time learner has said enough", () => {
    expect(shouldRewrite(EMPTY_MEMORY, 1)).toBe(false);
    expect(shouldRewrite(EMPTY_MEMORY, TURNS_BETWEEN_REWRITES)).toBe(true);
  });

  it("never rewrites on no turns at all", () => {
    expect(shouldRewrite(EMPTY_MEMORY, 0)).toBe(false);
    expect(shouldRewrite(EMPTY_MEMORY, -3)).toBe(false);
  });

  it("counts the learner's whole history, not one session", () => {
    // Otherwise someone who asks two questions a day would never accumulate
    // enough in a single sitting to be remembered at all.
    expect(shouldRewrite({ summary: "", openQuestions: [], turnsSeen: 2, turnsTotal: 6 }, 6)).toBe(true);
  });
});

describe("memoryBlock", () => {
  it("says nothing when nothing is remembered", () => {
    expect(memoryBlock(EMPTY_MEMORY)).toBe("");
  });

  it("hedges hard, because these notes are a model's own summary", () => {
    const text = memoryBlock({
      summary: "Prefers examples before rules; keeps mixing up ب- and راح.",
      openQuestions: ["when do you drop the ال?"],
      turnsSeen: 8,
      turnsTotal: 8,
    });
    expect(text).toContain("Prefers examples before rules");
    expect(text).toContain("when do you drop the ال?");
    expect(text).toContain("your own notes, not their words");
    expect(text).toContain("never as a fact about them");
    // The failure mode this guards: a tutor announcing to a learner what they
    // are bad at, on the strength of a summary of a summary.
    expect(text).toContain("do not tell them what they struggle with");
    expect(text).toContain("drop it the moment what they say contradicts it");
  });

  it("renders open questions with no summary", () => {
    const text = memoryBlock({ summary: "", openQuestions: ["why كان?"], turnsSeen: 4, turnsTotal: 4 });
    expect(text).toContain("Left unresolved last time");
  });
});
