import { describe, expect, it } from "vitest";
import {
  REPLY_WORD_CLEAR,
  SPEECH_MATCH_FLOOR,
  SPEECH_THRESHOLDS,
  assessmentLocale,
  gradeQuizAnswer,
  singleWordSimilarity,
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

describe("a spoken reply (step 9)", () => {
  const reply = (score: number, similarity: number | null) =>
    gradeQuizAnswer({ kind: "speech", score, similarity, reply: true });

  it("is never a lapse when the word was clearly said, however low the take scored", () => {
    // A right answer in other words loses on completeness against the stored
    // line; it is Hard, not Again.
    expect(reply(30, 1)).toBe("hard");
    expect(reply(SPEECH_THRESHOLDS.hard - 1, REPLY_WORD_CLEAR)).toBe("hard");
  });

  it("is still Again without the word, or with only something like it", () => {
    expect(reply(30, SPEECH_MATCH_FLOOR - 0.01)).toBe("again");
    // Close enough not to be a different word, not clear enough to lift a low score.
    expect(reply(30, REPLY_WORD_CLEAR - 0.01)).toBe("again");
    expect(reply(30, null)).toBe("again");
  });

  it("bands a reply that scored well exactly as any take", () => {
    expect(reply(90, 1)).toBe("easy");
    expect(reply(75, 1)).toBe("good");
  });

  it("lifts nothing that is not a reply", () => {
    expect(gradeQuizAnswer({ kind: "speech", score: 30, similarity: 1 })).toBe("again");
  });

  it("counts a short word as clear only when it was heard exactly", () => {
    // زين heard as وين: the span is held below the floor, so no lift.
    expect(reply(30, wordSpanSimilarity("وين", "زين"))).toBe("again");
    expect(reply(30, wordSpanSimilarity("الأكل زين", "زين"))).toBe("hard");
  });
});

describe("the word said in a story (step 10)", () => {
  // A single-word take: the word, against the word. The take is read through
  // `singleWordSimilarity`, so the word heard with و, ب or ال attached is the
  // word, and the word among others is not; the bands are the ordinary ones;
  // and the step-9 rule does not apply, because what lowers a reply's score
  // there — a right answer in other words than the stored line — cannot
  // happen when the reference is the word itself.
  const take = (score: number, heard: string, word = "قهوة") => ({
    kind: "speech" as const,
    score,
    similarity: singleWordSimilarity(heard, word),
  });

  it("bands the take on the ordinary bands", () => {
    expect(gradeQuizAnswer(take(SPEECH_THRESHOLDS.easy, "قهوة"))).toBe("easy");
    expect(gradeQuizAnswer(take(SPEECH_THRESHOLDS.good, "والقهوة"))).toBe("good");
    expect(gradeQuizAnswer(take(SPEECH_THRESHOLDS.hard, "للقهوة"))).toBe("hard");
  });

  it("is Again for a different word, however well it scored", () => {
    expect(gradeQuizAnswer(take(95, "شاي"))).toBe("again");
    // A word of three letters or fewer, one letter off, is another word.
    expect(gradeQuizAnswer(take(95, "وين", "زين"))).toBe("again");
  });

  it("is Again for the word among guesses, or the sentence read back, however well it scored", () => {
    // Azure charges extra words a few points at most, so a best-window reading
    // would hand the step to whoever names enough candidates.
    expect(gradeQuizAnswer(take(89, "شاي قهوة حليب"))).toBe("again");
    expect(gradeQuizAnswer(take(92, "مطعم سوق", "سوق"))).toBe("again");
    expect(gradeQuizAnswer(take(90, "طلب الريال قهوة حارة"))).toBe("again");
  });

  it("is Again for the word said too poorly, clear or not: no reply's leniency", () => {
    const low = take(SPEECH_THRESHOLDS.hard - 5, "قهوة");
    expect(low.similarity).toBeGreaterThanOrEqual(REPLY_WORD_CLEAR);
    expect(gradeQuizAnswer(low)).toBe("again");
  });

  it("caps a take at Hard when the passage's translation was opened first", () => {
    expect(gradeQuizAnswer({ ...take(95, "قهوة"), hintUsed: true })).toBe("hard");
  });

  it("is graded as a choice when picked from four, never better than Good", () => {
    expect(gradeQuizAnswer({ kind: "choice", correct: true })).toBe("good");
    expect(gradeQuizAnswer({ kind: "choice", correct: false })).toBe("again");
  });
});

describe("singleWordSimilarity", () => {
  it("reads a take of the word alone as the word, a prefix taken off", () => {
    expect(singleWordSimilarity("قهوة", "قهوة")).toBe(1);
    expect(singleWordSimilarity("بالسوق", "سوق")).toBe(1);
    expect(singleWordSimilarity("للسوق", "سوق")).toBe(1);
  });

  it("ignores a letter the recogniser split off on its own", () => {
    expect(singleWordSimilarity("و قهوة", "قهوة")).toBe(1);
  });

  it("holds a take of more words than the item below the floor", () => {
    expect(singleWordSimilarity("شاي قهوة", "قهوة")!).toBeLessThan(SPEECH_MATCH_FLOOR);
  });

  it("reads a phrase said whole as the phrase", () => {
    expect(singleWordSimilarity("كل يوم", "كل يوم")).toBe(1);
  });

  it("is no comparison when nothing was heard", () => {
    expect(singleWordSimilarity("", "قهوة")).toBeNull();
    expect(singleWordSimilarity(null, "قهوة")).toBeNull();
  });
});

describe("the locale a take is heard in", () => {
  it("follows the word's dialect, and Gulf otherwise", () => {
    expect(assessmentLocale("Egyptian")).toBe("ar-EG");
    expect(assessmentLocale("Yemeni")).toBe("ar-YE");
    expect(assessmentLocale("Gulf")).toBe("ar-SA");
    expect(assessmentLocale(null)).toBe("ar-SA");
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

  it("takes the word with a conjunction, preposition or article attached as the word", () => {
    expect(wordSpanSimilarity("ايه والقهوة جاهزة", "قهوة")).toBe(1);
    expect(wordSpanSimilarity("رحت بالسيارة", "سيارة")).toBe(1);
    expect(wordSpanSimilarity("لا ولا والله", "لا")).toBe(1);
  });

  it("holds a short word to itself: one letter off is another word", () => {
    // زين / وين is 0.67 by similarity alone, well over the floor.
    for (const [heard, word] of [
      ["والله ما ادري وين راح", "زين"],
      ["ايه شي حلو", "شو"],
      ["ما ادري", "مو"],
    ] as const) {
      const similarity = wordSpanSimilarity(heard, word);
      expect(similarity!, `${heard} / ${word}`).toBeLessThan(SPEECH_MATCH_FLOOR);
      expect(gradeQuizAnswer({ kind: "speech", score: 95, similarity })).toBe("again");
    }
    expect(wordSpanSimilarity("ايه زين والله", "زين")).toBe(1);
    expect(wordSpanSimilarity("وزين", "زين")).toBe(1);
  });

  it("still allows a longer word the recogniser spelt a letter off", () => {
    expect(wordSpanSimilarity("رحت المدرسه بدري", "المدرسة")!).toBeGreaterThanOrEqual(SPEECH_MATCH_FLOOR);
    expect(wordSpanSimilarity("ايه عطني قهوا", "قهوة")!).toBeGreaterThanOrEqual(SPEECH_MATCH_FLOOR);
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
