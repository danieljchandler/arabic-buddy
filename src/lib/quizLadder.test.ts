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

const everything: QuizMaterial = {
  hasSentence: true,
  hasImage: true,
  distractors: 10,
  imageDistractors: 10,
  hasReply: true,
  hasReplyLine: true,
  hasStoryLine: true,
  canSpeak: true,
};

const T = LADDER_THRESHOLDS;

describe("the step a memory state lands on", () => {
  it("asks a never-seen word for a first look", () => {
    expect(rungForMemory({ stability: 0, repetitions: 0 }, "recognition").step).toBe(1);
  });

  it("sends a just-forgotten word back to the first look, whatever its history", () => {
    // Relearning resets stability to under a day; the step follows the
    // memory, not the number of times the word has been reviewed.
    expect(rungForMemory({ stability: 0.4, repetitions: 9 }, "recognition").step).toBe(1);
  });

  it("climbs one recognition step per threshold", () => {
    const at = (stability: number) => rungForMemory({ stability, repetitions: 2 }, "recognition").step;
    expect(at(T.firstLookDays)).toBe(2);
    expect(at(T.gapDays - 0.01)).toBe(2);
    expect(at(T.gapDays)).toBe(3);
    expect(at(T.pictureDays - 0.01)).toBe(3);
    expect(at(T.pictureDays)).toBe(4);
    expect(at(T.hearDays - 0.01)).toBe(4);
    expect(at(T.hearDays)).toBe(5);
    expect(at(T.wordDays - 0.01)).toBe(5);
    expect(at(T.wordDays)).toBe(6);
    expect(at(400)).toBe(6);
  });

  it("asks a production card to say the word, then the line, then the reply, then the word in a story", () => {
    expect(rungForMemory({ stability: 0, repetitions: 0 }, "production").step).toBe(7);
    expect(rungForMemory({ stability: T.sentenceDays - 1, repetitions: 3 }, "production").step).toBe(7);
    expect(rungForMemory({ stability: T.sentenceDays, repetitions: 3 }, "production").step).toBe(8);
    expect(rungForMemory({ stability: T.replyDays - 0.01, repetitions: 5 }, "production").step).toBe(8);
    expect(rungForMemory({ stability: T.replyDays, repetitions: 5 }, "production").step).toBe(9);
    expect(rungForMemory({ stability: T.storyDays - 0.01, repetitions: 6 }, "production")).toEqual({
      step: 9,
      label: "Say the reply",
      format: "speak-reply",
    });
    expect(rungForMemory({ stability: T.storyDays, repetitions: 7 }, "production").step).toBe(10);
    expect(rungForMemory({ stability: 400, repetitions: 9 }, "production")).toEqual({
      step: 10,
      label: "In a story",
      format: "story-gap",
    });
  });

  it("puts the reply above the line, and the story above the reply, on the production schedule", () => {
    expect(T.replyDays).toBeGreaterThan(T.sentenceDays);
    expect(T.storyDays).toBeGreaterThan(T.replyDays);
  });

  it("treats a missing or negative stability as new", () => {
    expect(rungForMemory({ stability: Number.NaN, repetitions: 4 }, "recognition").step).toBe(1);
    expect(rungForMemory({ stability: -2, repetitions: 4 }, "recognition").step).toBe(1);
  });

  it("labels every step and never goes past the ladder", () => {
    const seen = new Set<number>();
    for (const stability of [0, 2, 6, 12, 20, 60]) {
      const r = rungForMemory({ stability, repetitions: 1 }, "recognition");
      expect(r.label.length).toBeGreaterThan(0);
      seen.add(r.step);
    }
    for (const stability of [2, 20, 40, 90]) seen.add(rungForMemory({ stability, repetitions: 1 }, "production").step);
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(Math.max(...seen)).toBe(QUIZ_STEP_COUNT);
  });
});

describe("the question asked, given the material", () => {
  const recog = (stability: number, material: QuizMaterial = everything) =>
    pickQuizFormat({ stability, repetitions: stability > 0 ? 2 : 0 }, "recognition", material);

  it("cuts a gap from the sentence on the first two steps, with the hint only on the first", () => {
    expect(recog(0)).toBe("cloze-hint");
    expect(recog(2)).toBe("cloze");
  });

  it("asks for the meaning when there is no sentence to cut a gap from", () => {
    const noSentence = { ...everything, hasSentence: false };
    // The word stays in view on a first look; once seen, it is heard instead.
    expect(recog(0, noSentence)).toBe("meaning");
    expect(recog(2, noSentence)).toBe("listen");
  });

  it("asks for the picture, then the audio alone, then the word, then the reply", () => {
    expect(recog(T.gapDays)).toBe("picture-choice");
    expect(recog(T.pictureDays)).toBe("listen");
    expect(recog(T.hearDays)).toBe("word-choice");
    expect(recog(T.wordDays)).toBe("reply-choice");
  });

  it("hears a word that has no picture, or too few other pictures, instead", () => {
    expect(recog(T.gapDays, { ...everything, hasImage: false })).toBe("listen");
    expect(recog(T.gapDays, { ...everything, imageDistractors: CHOICE_COUNT - 2 })).toBe("listen");
    expect(recog(T.gapDays, { ...everything, imageDistractors: CHOICE_COUNT - 1 })).toBe("picture-choice");
  });

  it("picks the word instead of the reply when the word has no dialogue", () => {
    expect(recog(T.wordDays, { ...everything, hasReply: false })).toBe("word-choice");
  });

  it("falls back to the flashcard when there are not enough wrong options", () => {
    const thin = { ...everything, distractors: CHOICE_COUNT - 2 };
    expect(recog(0, thin)).toBe("flashcard");
    expect(recog(T.pictureDays, thin)).toBe("flashcard");
    expect(recog(T.hearDays, thin)).toBe("flashcard");
    expect(recog(T.wordDays, { ...thin, hasReply: false })).toBe("flashcard");
    // Exactly enough is enough.
    expect(recog(0, { ...everything, distractors: CHOICE_COUNT - 1 })).toBe("cloze-hint");
  });

  it("asks a production card to be said, and the line once it is mature", () => {
    expect(pickQuizFormat({ stability: 2, repetitions: 1 }, "production", everything)).toBe("speak");
    expect(pickQuizFormat({ stability: 20, repetitions: 4 }, "production", everything)).toBe("speak-sentence");
  });

  it("asks a mature production card to say the word in a story, from its passage", () => {
    const at10 = { stability: T.storyDays, repetitions: 7 };
    expect(pickQuizFormat(at10, "production", everything)).toBe("story-gap");
    // Saying the word needs no wrong options: the passage is enough.
    expect(pickQuizFormat(at10, "production", { ...everything, distractors: 0 })).toBe("story-gap");
  });

  it("asks the reply instead when the word has no passage, and what the reply falls back to", () => {
    const at10 = { stability: T.storyDays, repetitions: 7 };
    const noStory = { ...everything, hasStoryLine: false };
    expect(pickQuizFormat(at10, "production", noStory)).toBe("speak-reply");
    expect(pickQuizFormat(at10, "production", { ...noStory, hasReplyLine: false })).toBe("speak-sentence");
    expect(pickQuizFormat(at10, "production", { ...noStory, hasReplyLine: false, hasSentence: false })).toBe("speak");
  });

  it("asks the story's gap with four options on a device that cannot record, and the flip card with too few", () => {
    const at10 = { stability: T.storyDays, repetitions: 7 };
    const mute = { ...everything, canSpeak: false };
    expect(pickQuizFormat(at10, "production", mute)).toBe("story-choice");
    expect(pickQuizFormat(at10, "production", { ...mute, distractors: CHOICE_COUNT - 1 })).toBe("story-choice");
    expect(pickQuizFormat(at10, "production", { ...mute, distractors: CHOICE_COUNT - 2 })).toBe("flashcard");
    // No passage and no microphone: the reply cannot be said either.
    expect(pickQuizFormat(at10, "production", { ...mute, hasStoryLine: false })).toBe("flashcard");
  });

  it("asks a well-settled production card to say the reply", () => {
    expect(pickQuizFormat({ stability: T.replyDays, repetitions: 6 }, "production", everything)).toBe("speak-reply");
    // Saying the reply needs no wrong replies: a line to answer is enough.
    expect(
      pickQuizFormat({ stability: T.replyDays, repetitions: 6 }, "production", { ...everything, hasReply: false }),
    ).toBe("speak-reply");
  });

  it("says the line instead of the reply when the word has no dialogue, and the word when it has no sentence", () => {
    const at9 = { stability: T.replyDays, repetitions: 6 };
    expect(pickQuizFormat(at9, "production", { ...everything, hasReplyLine: false })).toBe("speak-sentence");
    expect(pickQuizFormat(at9, "production", { ...everything, hasReplyLine: false, hasSentence: false })).toBe("speak");
  });

  it("asks for the word alone when a mature production card has no sentence", () => {
    expect(
      pickQuizFormat({ stability: 20, repetitions: 4 }, "production", { ...everything, hasSentence: false }),
    ).toBe("speak");
  });

  it("serves the flashcard when the device cannot record, below the story", () => {
    // Never a choice question: the rating lands on the production schedule,
    // which a recognition task must not write to. The story's gap is the one
    // exception (above), and it is never better than Good.
    const mute = { ...everything, canSpeak: false };
    expect(pickQuizFormat({ stability: 2, repetitions: 1 }, "production", mute)).toBe("flashcard");
    expect(pickQuizFormat({ stability: 20, repetitions: 4 }, "production", mute)).toBe("flashcard");
    expect(pickQuizFormat({ stability: T.replyDays, repetitions: 6 }, "production", mute)).toBe("flashcard");
  });
});

describe("holding production back", () => {
  it("holds a word until its recognition has reached the picture step", () => {
    // Unlocked on the first Good, the production card would otherwise come
    // back in the same session, before the word was ever heard alone.
    expect(holdsProduction(0)).toBe(true);
    expect(holdsProduction(T.pictureDays - 0.1)).toBe(true);
    expect(holdsProduction(T.pictureDays)).toBe(false);
    expect(holdsProduction(60)).toBe(false);
  });

  it("holds a word with no stability at all", () => {
    expect(holdsProduction(Number.NaN)).toBe(true);
  });
});

describe("what a format implies", () => {
  it("grades everything but the flashcard", () => {
    expect(isGradedFormat("cloze")).toBe(true);
    expect(isGradedFormat("picture-choice")).toBe(true);
    expect(isGradedFormat("speak")).toBe(true);
    expect(isGradedFormat("story-gap")).toBe(true);
    expect(isGradedFormat("story-choice")).toBe(true);
    expect(isGradedFormat("flashcard")).toBe(false);
  });

  it("knows which formats are spoken", () => {
    expect(isSpokenFormat("speak")).toBe(true);
    expect(isSpokenFormat("speak-sentence")).toBe(true);
    expect(isSpokenFormat("speak-reply")).toBe(true);
    expect(isSpokenFormat("story-gap")).toBe(true);
    expect(isSpokenFormat("story-choice")).toBe(false);
    expect(isSpokenFormat("listen")).toBe(false);
    expect(isSpokenFormat("reply-choice")).toBe(false);
  });
});
