import { describe, expect, it } from "vitest";
import { isGradedFormat, isSpokenFormat, type QuizFormat } from "./quizLadder";
import { whyNotQuestion, type WhyNotFormat, type WhyNotInput } from "./quizWhyNot";

/**
 * "Why not this one?" on a wrong pick (quiz Phase 7): the question the tutor
 * is asked, by itself, for each choice step. What has to hold: it names the
 * pair and what it was picked for, so the answer is about this mix-up; and
 * every choice format on the ladder has one.
 */

describe("whyNotQuestion", () => {
  it("puts the pair to the tutor, about this passage's gap (the story's four options)", () => {
    expect(whyNotQuestion({ format: "story-choice", picked: "شاي", answer: "قهوة", meaning: "coffee" })).toBe(
      'In this passage I put «شاي» in the gap, but the word is «قهوة» ("coffee"). Why doesn\'t «شاي» fit here?',
    );
  });

  it("asks about the sentence's gap on the first two steps", () => {
    for (const format of ["cloze-hint", "cloze"] as const) {
      expect(whyNotQuestion({ format, picked: "بيت", answer: "السوق", meaning: "the market" })).toBe(
        'In this sentence I put «بيت» in the gap, but the word is «السوق» ("the market"). Why doesn\'t «بيت» fit here?',
      );
    }
  });

  it("asks how to tell the word from the meaning picked for it, naming that meaning's word where the deck knows it", () => {
    expect(
      whyNotQuestion({ format: "meaning", word: "سوق", picked: "house", pickedWord: "بيت", meaning: "market" }),
    ).toBe('I picked "house" (that\'s «بيت») for «سوق», but «سوق» means "market". How do I tell them apart?');
    expect(whyNotQuestion({ format: "meaning", word: "سوق", picked: "house", meaning: "market" })).toBe(
      'I picked "house" for «سوق», but «سوق» means "market". How do I tell them apart?',
    );
  });

  it("asks about the sound when the word was only heard", () => {
    expect(
      whyNotQuestion({ format: "listen", word: "سوق", picked: "leg", pickedWord: "ساق", meaning: "market" }),
    ).toBe('I heard «سوق» and picked "leg" (that\'s «ساق»), but it means "market". How do I hear the difference?');
  });

  it("names the picture picked by what it shows", () => {
    expect(whyNotQuestion({ format: "picture-choice", word: "قهوة", picked: "tea", pickedWord: "شاي", meaning: "coffee" })).toBe(
      'I picked the picture of "tea" (that\'s «شاي») for «قهوة», but «قهوة» means "coffee". How do I tell them apart?',
    );
  });

  it("asks why the word picked for a meaning is not the word", () => {
    expect(
      whyNotQuestion({ format: "word-choice", picked: "شاي", pickedMeaning: "tea", answer: "قهوة", meaning: "coffee" }),
    ).toBe('I picked «شاي» ("tea") for "coffee", but the word is «قهوة». Why isn\'t it «شاي»?');
    expect(whyNotQuestion({ format: "word-choice", picked: "شاي", answer: "قهوة", meaning: "coffee" })).toBe(
      'I picked «شاي» for "coffee", but the word is «قهوة». Why isn\'t it «شاي»?',
    );
  });

  it("asks why the reply picked does not answer the line said", () => {
    expect(
      whyNotQuestion({ format: "reply-choice", line: "وين رايح؟", picked: "الحمد لله", answer: "رايح السوق" }),
    ).toBe('Someone said «وين رايح؟» and I answered «الحمد لله», but the reply is «رايح السوق». Why doesn\'t «الحمد لله» fit as the answer?');
  });
});

describe("every choice step offers it", () => {
  // Every format on the ladder, so a new one has to be placed here: a
  // `Record` over the union fails the typecheck when one is missing.
  const EVERY_FORMAT: Record<QuizFormat, true> = {
    "cloze-hint": true,
    cloze: true,
    meaning: true,
    "picture-choice": true,
    listen: true,
    "word-choice": true,
    "reply-choice": true,
    speak: true,
    "speak-sentence": true,
    "speak-reply": true,
    "story-gap": true,
    "story-choice": true,
    flashcard: true,
  };

  /** A question for each format this module covers; a missing key fails the typecheck. */
  const ASKED: Record<WhyNotFormat, WhyNotInput> = {
    "cloze-hint": { format: "cloze-hint", picked: "PICKED", answer: "b", meaning: "m" },
    cloze: { format: "cloze", picked: "PICKED", answer: "b", meaning: "m" },
    "story-choice": { format: "story-choice", picked: "PICKED", answer: "b", meaning: "m" },
    meaning: { format: "meaning", word: "w", picked: "PICKED", meaning: "m" },
    listen: { format: "listen", word: "w", picked: "PICKED", meaning: "m" },
    "picture-choice": { format: "picture-choice", word: "w", picked: "PICKED", meaning: "m" },
    "word-choice": { format: "word-choice", picked: "PICKED", answer: "b", meaning: "m" },
    "reply-choice": { format: "reply-choice", line: "l", picked: "PICKED", answer: "b" },
  };

  it("is every graded format but the spoken ones, and nothing else", () => {
    const choices = (Object.keys(EVERY_FORMAT) as QuizFormat[])
      .filter((format) => isGradedFormat(format) && !isSpokenFormat(format))
      .sort();
    expect(Object.keys(ASKED).sort()).toEqual(choices);
  });

  it("asks a question naming the pick for each", () => {
    for (const input of Object.values(ASKED)) {
      const question = whyNotQuestion(input);
      expect(question).toContain("PICKED");
      expect(question.endsWith("?")).toBe(true);
    }
  });
});
