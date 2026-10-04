import { describe, expect, it } from "vitest";
import {
  debriefPath,
  nextStep,
  pendingCard,
  quizRating,
  toWireMessages,
  wordsToReview,
  type DebriefItem,
  type QuizItem,
  type ShadowLine,
} from "./videoDebrief";

const quizItem = (arabic: string, english: string, vocabularyId?: string): QuizItem => ({
  id: arabic,
  arabic,
  english,
  source: vocabularyId ? "saved" : "key_vocab",
  vocabularyId,
  options: [english, "other", "another"],
  answerIndex: 0,
});

const shadowLine = (n: number): ShadowLine => ({
  lineId: `l${n}`,
  lineNumber: n,
  arabic: `سطر ${n}`,
  startMs: n * 1000,
  endMs: n * 1000 + 900,
});

describe("toWireMessages", () => {
  it("flattens the thread, describing every finished card", () => {
    const items: DebriefItem[] = [
      { kind: "tutor", id: "1", step: "words", text: "Quick quiz on your words.", streaming: false },
      {
        kind: "quiz",
        id: "2",
        step: "words",
        outcomes: [{ arabic: "تعبان", english: "tired", correct: false, chosen: "happy" }],
      },
      { kind: "learner", id: "3", step: "words", text: "I always mix that up" },
      { kind: "shadow", id: "4", step: "shadow", lineIndex: 0, outcome: { lineNumber: 2, arabic: "روح ارتاح", score: 64 } },
    ];
    expect(toWireMessages(items)).toEqual([
      { role: "assistant", content: "Quick quiz on your words." },
      { role: "user", content: '(Quiz finished — 0 of 1 right.)\nMissed: تعبان (tired) — picked "happy"' },
      { role: "user", content: "I always mix that up" },
      { role: "user", content: "(Shadowed line 2: روح ارتاح — score 64/100.)" },
    ]);
  });

  it("leaves out cards not yet finished and turns that never produced text", () => {
    const items: DebriefItem[] = [
      { kind: "tutor", id: "1", step: "gist", text: "", streaming: false },
      { kind: "quiz", id: "2", step: "words" },
      { kind: "shadow", id: "3", step: "shadow", lineIndex: 0 },
    ];
    expect(toWireMessages(items)).toEqual([]);
  });
});

describe("pendingCard", () => {
  const plan = { quiz: [quizItem("تعبان", "tired")], shadow: [shadowLine(2), shadowLine(5)] };

  it("puts the quiz after the tutor's introduction, once", () => {
    const intro: DebriefItem = { kind: "tutor", id: "1", step: "words", text: "Ready?", streaming: false };
    expect(pendingCard("words", [intro], plan)).toEqual({ kind: "quiz" });
    expect(pendingCard("words", [intro, { kind: "quiz", id: "2", step: "words" }], plan)).toBeNull();
  });

  it("has no quiz to show when there are no words", () => {
    expect(pendingCard("words", [], { quiz: [], shadow: [] })).toBeNull();
  });

  it("alternates shadowing cards with feedback until every line has had a turn", () => {
    expect(pendingCard("shadow", [], plan)).toEqual({ kind: "shadow", lineIndex: 0 });
    const first: DebriefItem = { kind: "shadow", id: "a", step: "shadow", lineIndex: 0 };
    // Still on screen: nothing new.
    expect(pendingCard("shadow", [first], plan)).toBeNull();
    const said = { ...first, outcome: { lineNumber: 2, arabic: "سطر 2", score: 80 } };
    expect(pendingCard("shadow", [said], plan)).toEqual({ kind: "shadow", lineIndex: 1 });
    const second = { kind: "shadow" as const, id: "b", step: "shadow" as const, lineIndex: 1, outcome: { lineNumber: 5, arabic: "سطر 5", score: null } };
    expect(pendingCard("shadow", [said, second], plan)).toBeNull();
  });

  it("never adds a card to the conversational steps", () => {
    expect(pendingCard("gist", [], plan)).toBeNull();
    expect(pendingCard("questions", [], plan)).toBeNull();
  });
});

describe("nextStep", () => {
  it("walks the session's own steps", () => {
    expect(nextStep(["gist", "comprehension", "questions", "recap"], "comprehension")).toBe("questions");
    expect(nextStep(["gist", "recap"], "recap")).toBeNull();
    expect(nextStep(["gist", "recap"], "words")).toBeNull();
  });
});

describe("quizRating", () => {
  it("records a quiz answer as a recognition review", () => {
    expect(quizRating(true)).toBe("good");
    expect(quizRating(false)).toBe("again");
  });
});

describe("wordsToReview", () => {
  it("lists the missed words, the learner's own cards first", () => {
    const quiz = [quizItem("زين", "well"), quizItem("تعبان", "tired", "v1"), quizItem("ارتاح", "rest")];
    const outcomes = [
      { arabic: "زين", english: "well", correct: false },
      { arabic: "تعبان", english: "tired", correct: false },
      { arabic: "ارتاح", english: "rest", correct: true },
    ];
    expect(wordsToReview(quiz, outcomes).map((q) => q.arabic)).toEqual(["تعبان", "زين"]);
    expect(wordsToReview(quiz, undefined)).toEqual([]);
  });
});

describe("debriefPath", () => {
  it("is keyed by video", () => {
    expect(debriefPath("abc")).toBe("/debrief/abc");
  });
});
