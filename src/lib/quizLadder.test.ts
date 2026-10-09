import { describe, expect, it } from "vitest";
import {
  CHOICE_COUNT,
  LADDER_THRESHOLDS,
  QUIZ_STEP_COUNT,
  holdsProduction,
  isGradedFormat,
  isSpokenFormat,
  pickQuizFormat,
  rungForMemory,
  type QuizMaterial,
} from "./quizLadder";

/**
 * The ladder is the quiz's whole claim to being spaced repetition with a
 * different flavour rather than a separate game: the question a card gets is
 * a function of its memory state, so a new word is asked the easiest thing,
 * a word the learner keeps failing drops back down, and a word they know is
 * asked to be said. These tests pin that mapping and the fallbacks that keep
 * the ladder from ever refusing to serve a card.
 */

const everything: QuizMaterial = { hasSentence: true, distractors: 10, canSpeak: true };

describe("the step a memory state lands on", () => {
  it("asks a never-seen word for a first look", () => {
    expect(rungForMemory({ stability: 0, repetitions: 0 }, "recognition").step).toBe(1);
  });

  it("sends a just-forgotten word back to the first look, whatever its history", () => {
    // Relearning resets stability to under a day; the step follows the
    // memory, not the number of times the word has been reviewed.
    expect(rungForMemory({ stability: 0.4, repetitions: 9 }, "recognition").step).toBe(1);
  });

  it("asks a young word to fill the gap without help", () => {
    expect(rungForMemory({ stability: 3, repetitions: 1 }, "recognition").step).toBe(2);
    expect(
      rungForMemory({ stability: LADDER_THRESHOLDS.gapDays - 0.01, repetitions: 2 }, "recognition").step,
    ).toBe(2);
  });

  it("asks a settled word to be heard rather than read", () => {
    expect(rungForMemory({ stability: LADDER_THRESHOLDS.gapDays, repetitions: 2 }, "recognition").step).toBe(3);
    expect(rungForMemory({ stability: 60, repetitions: 8 }, "recognition").step).toBe(3);
  });

  it("asks a production card to say the word, then the line", () => {
    expect(rungForMemory({ stability: 0, repetitions: 0 }, "production").step).toBe(4);
    expect(
      rungForMemory({ stability: LADDER_THRESHOLDS.sentenceDays - 1, repetitions: 3 }, "production").step,
    ).toBe(4);
    expect(rungForMemory({ stability: LADDER_THRESHOLDS.sentenceDays, repetitions: 3 }, "production").step).toBe(5);
  });

  it("treats a missing or negative stability as new", () => {
    expect(rungForMemory({ stability: Number.NaN, repetitions: 4 }, "recognition").step).toBe(1);
    expect(rungForMemory({ stability: -2, repetitions: 4 }, "recognition").step).toBe(1);
  });

  it("labels every step and never goes past the ladder", () => {
    for (const step of [1, 2, 3, 4, 5]) {
      const direction = step >= 4 ? "production" : "recognition";
      const stability = step === 1 ? 0 : step === 2 ? 3 : step === 3 ? 30 : step === 4 ? 3 : 30;
      const r = rungForMemory({ stability, repetitions: 1 }, direction);
      expect(r.step).toBe(step);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.step).toBeLessThanOrEqual(QUIZ_STEP_COUNT);
    }
  });
});

describe("the question asked, given the material", () => {
  it("cuts a gap from the sentence on the first two steps, with the hint only on the first", () => {
    expect(pickQuizFormat({ stability: 0, repetitions: 0 }, "recognition", everything)).toBe("cloze-hint");
    expect(pickQuizFormat({ stability: 3, repetitions: 1 }, "recognition", everything)).toBe("cloze");
  });

  it("asks for the meaning when there is no sentence to cut a gap from", () => {
    const noSentence = { ...everything, hasSentence: false };
    // The word stays in view on a first look; once seen, it is heard instead.
    expect(pickQuizFormat({ stability: 0, repetitions: 0 }, "recognition", noSentence)).toBe("meaning");
    expect(pickQuizFormat({ stability: 3, repetitions: 1 }, "recognition", noSentence)).toBe("listen");
  });

  it("plays the audio alone once the word is settled", () => {
    expect(pickQuizFormat({ stability: 30, repetitions: 4 }, "recognition", everything)).toBe("listen");
  });

  it("falls back to the flashcard when there are not enough wrong options", () => {
    const thin = { ...everything, distractors: CHOICE_COUNT - 2 };
    expect(pickQuizFormat({ stability: 0, repetitions: 0 }, "recognition", thin)).toBe("flashcard");
    expect(pickQuizFormat({ stability: 30, repetitions: 4 }, "recognition", thin)).toBe("flashcard");
    // Exactly enough is enough.
    expect(
      pickQuizFormat({ stability: 0, repetitions: 0 }, "recognition", { ...everything, distractors: CHOICE_COUNT - 1 }),
    ).toBe("cloze-hint");
  });

  it("asks a production card to be said, and the line once it is mature", () => {
    expect(pickQuizFormat({ stability: 2, repetitions: 1 }, "production", everything)).toBe("speak");
    expect(pickQuizFormat({ stability: 20, repetitions: 4 }, "production", everything)).toBe("speak-sentence");
  });

  it("asks for the word alone when a mature production card has no sentence", () => {
    expect(
      pickQuizFormat({ stability: 20, repetitions: 4 }, "production", { ...everything, hasSentence: false }),
    ).toBe("speak");
  });

  it("serves the flashcard when the device cannot record", () => {
    // Never a choice question: the rating lands on the production schedule,
    // which a recognition task must not write to.
    const mute = { ...everything, canSpeak: false };
    expect(pickQuizFormat({ stability: 2, repetitions: 1 }, "production", mute)).toBe("flashcard");
    expect(pickQuizFormat({ stability: 20, repetitions: 4 }, "production", mute)).toBe("flashcard");
  });
});

describe("what a format implies", () => {
  it("grades everything but the flashcard", () => {
    expect(isGradedFormat("cloze")).toBe(true);
    expect(isGradedFormat("speak")).toBe(true);
    expect(isGradedFormat("flashcard")).toBe(false);
  });

  it("knows which formats are spoken", () => {
    expect(isSpokenFormat("speak")).toBe(true);
    expect(isSpokenFormat("speak-sentence")).toBe(true);
    expect(isSpokenFormat("listen")).toBe(false);
    expect(isSpokenFormat("cloze-hint")).toBe(false);
  });
});

describe("holding production back", () => {
  it("holds a word until its recognition has reached the heard step", () => {
    // Unlocked on the first Good, the production card would otherwise come
    // back in the same session, before the word was ever heard alone.
    expect(holdsProduction(0)).toBe(true);
    expect(holdsProduction(LADDER_THRESHOLDS.gapDays - 0.1)).toBe(true);
    expect(holdsProduction(LADDER_THRESHOLDS.gapDays)).toBe(false);
    expect(holdsProduction(60)).toBe(false);
  });

  it("holds a word with no stability at all", () => {
    expect(holdsProduction(Number.NaN)).toBe(true);
  });
});
