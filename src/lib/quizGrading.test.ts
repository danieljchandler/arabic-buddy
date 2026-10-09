import { describe, expect, it } from "vitest";
import {
  SPEECH_MATCH_FLOOR,
  SPEECH_THRESHOLDS,
  gradeQuizAnswer,
  isCorrectRating,
  wordSpanSimilarity,
} from "./quizGrading";

/**
 * The rating the app writes for a quiz answer. Every value here reaches the
 * scheduler unchanged, so the ceilings matter more than the floors: a choice
 * question must never produce Easy, and a take that was a different word must
 * never produce anything but Again.
 */

describe("a choice question", () => {
  it("earns Good for a right answer, never Easy", () => {
    expect(gradeQuizAnswer({ kind: "choice", correct: true })).toBe("good");
  });

  it("earns Hard for a right answer reached with help", () => {
    expect(gradeQuizAnswer({ kind: "choice", correct: true, hintUsed: true })).toBe("hard");
  });

  it("is Again when wrong, help or no help", () => {
    expect(gradeQuizAnswer({ kind: "choice", correct: false })).toBe("again");
    expect(gradeQuizAnswer({ kind: "choice", correct: false, hintUsed: true })).toBe("again");
  });
});

describe("a spoken answer", () => {
  it("bands the calibrated score", () => {
    expect(gradeQuizAnswer({ kind: "speech", score: SPEECH_THRESHOLDS.easy, similarity: 1 })).toBe("easy");
    expect(gradeQuizAnswer({ kind: "speech", score: SPEECH_THRESHOLDS.easy - 1, similarity: 1 })).toBe("good");
    expect(gradeQuizAnswer({ kind: "speech", score: SPEECH_THRESHOLDS.good, similarity: 1 })).toBe("good");
    expect(gradeQuizAnswer({ kind: "speech", score: SPEECH_THRESHOLDS.hard, similarity: 1 })).toBe("hard");
    expect(gradeQuizAnswer({ kind: "speech", score: SPEECH_THRESHOLDS.hard - 1, similarity: 1 })).toBe("again");
  });

  it("is Again when a different word was said, however well it scored", () => {
    // The assessment scores sounds against the reference, so a confident
    // wrong word can still score; the transcript is what says it was wrong.
    expect(
      gradeQuizAnswer({ kind: "speech", score: 95, similarity: SPEECH_MATCH_FLOOR - 0.01 }),
    ).toBe("again");
  });

  it("caps a take at Hard when the meaning was asked for first", () => {
    expect(gradeQuizAnswer({ kind: "speech", score: 95, similarity: 1, hintUsed: true })).toBe("hard");
    expect(gradeQuizAnswer({ kind: "speech", score: 75, similarity: 1, hintUsed: true })).toBe("hard");
    // A poor take is still a miss, help or no help.
    expect(
      gradeQuizAnswer({ kind: "speech", score: SPEECH_THRESHOLDS.hard - 1, similarity: 1, hintUsed: true }),
    ).toBe("again");
  });

  it("trusts the score alone when nothing was recognised to compare", () => {
    expect(gradeQuizAnswer({ kind: "speech", score: 90, similarity: null })).toBe("easy");
  });

  it("treats a missing score as a miss", () => {
    expect(gradeQuizAnswer({ kind: "speech", score: Number.NaN, similarity: 1 })).toBe("again");
  });
});

describe("the session tally", () => {
  it("counts everything but Again as correct", () => {
    expect(isCorrectRating("again")).toBe(false);
    expect(isCorrectRating("hard")).toBe(true);
    expect(isCorrectRating("good")).toBe(true);
    expect(isCorrectRating("easy")).toBe(true);
  });
});

describe("the word's span of a spoken reply", () => {
  it("finds the word anywhere in a line that was heard", () => {
    expect(wordSpanSimilarity("ايه عطني قهوة لو سمحت", "قهوة")).toBe(1);
    // Spelt differently by the recogniser, vowelled in the target.
    expect(wordSpanSimilarity("ايه، عطني قهوه.", "قَهْوَة")).toBe(1);
  });

  it("is far from the word when the line was said without it", () => {
    const similarity = wordSpanSimilarity("ايه عطني شاي لو سمحت", "قهوة");
    expect(similarity).not.toBeNull();
    expect(similarity!).toBeLessThan(SPEECH_MATCH_FLOOR);
    // And that grades the take Again, however well the line was said.
    expect(gradeQuizAnswer({ kind: "speech", score: 95, similarity })).toBe("again");
  });

  it("is generous to an attached article or conjunction, as for a single word", () => {
    expect(wordSpanSimilarity("ايه والقهوة جاهزة", "قهوة")!).toBeGreaterThanOrEqual(SPEECH_MATCH_FLOOR);
  });

  it("compares a phrase against runs of as many words", () => {
    expect(wordSpanSimilarity("الله يعطيك العافية يا خوي", "يعطيك العافية")).toBe(1);
  });

  it("is no comparison when nothing was heard", () => {
    expect(wordSpanSimilarity("", "قهوة")).toBeNull();
    expect(wordSpanSimilarity("  ، ", "قهوة")).toBeNull();
    expect(wordSpanSimilarity(null, "قهوة")).toBeNull();
  });
});
