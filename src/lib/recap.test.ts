import { afterEach, describe, expect, it } from "vitest";
import {
  dismissRecapNudge,
  isRecapNudgeDismissed,
  nextRecapStep,
  pendingRecapCard,
  recapClock,
  recapOutcome,
  recapTitle,
  recapWordsToReview,
  shouldShowRecapNudge,
  toRecapWireMessages,
  type RecapItem,
  type RecapQuizItem,
  type RecapSummary,
} from "./recap";

/**
 * The recap's client half: how the page's thread becomes the tutor's
 * messages, which card follows which step, what the server is told about the
 * learner's clock, and when the strip at the bottom of the screen shows.
 */

const summary: RecapSummary = {
  date: "2026-10-05",
  windowDays: 1,
  hasContent: true,
  counts: { videos: 1, words: 4, lookups: 1, slips: 1, lessons: 0, stories: 0, chats: 0 },
  headline: "Yesterday: 1 video, 4 new words, 1 slip",
  firstVideo: "A tired friend",
  status: "ready",
};

const tired: RecapQuizItem = {
  id: "q1",
  arabic: "تعبان",
  english: "tired",
  source: "saved",
  vocabularyId: "v1",
  options: ["happy", "tired"],
  answerIndex: 1,
};
const lastNight: RecapQuizItem = { id: "q2", arabic: "البارحة", english: "last night", source: "looked_up", options: [], answerIndex: -1 };
const plan = { quiz: [tired, lastNight], shadow: [{ lineId: "l1" }, { lineId: "l2" }] } as unknown as Parameters<typeof pendingRecapCard>[2];

afterEach(() => {
  window.localStorage.clear();
});

describe("toRecapWireMessages", () => {
  it("flattens the thread into the two voices, describing finished cards in the tutor's words", () => {
    const items: RecapItem[] = [
      { kind: "tutor", id: "1", step: "yesterday", text: "Yesterday you watched a clip.", streaming: false },
      { kind: "learner", id: "2", step: "yesterday", text: "I remember the tired friend" },
      { kind: "tutor", id: "3", step: "words", text: "", streaming: false },
      { kind: "quiz", id: "4", step: "words", outcomes: [{ arabic: "تعبان", english: "tired", correct: true }] },
      { kind: "shadow", id: "5", step: "shadow", lineIndex: 0 },
      { kind: "shadow", id: "6", step: "shadow", lineIndex: 1, outcome: { lineNumber: 2, arabic: "x", score: null } },
    ];
    expect(toRecapWireMessages(items)).toEqual([
      { role: "assistant", content: "Yesterday you watched a clip." },
      { role: "user", content: "I remember the tired friend" },
      { role: "user", content: "(Quiz finished — 1 of 1 right.)\nKnew: تعبان (tired)" },
      { role: "user", content: "(Skipped shadowing line 2: x)" },
    ]);
  });
});

describe("pendingRecapCard", () => {
  it("puts the quiz after the words step's opening line, once", () => {
    expect(pendingRecapCard("words", [], plan)).toEqual({ kind: "quiz" });
    expect(pendingRecapCard("words", [{ kind: "quiz", id: "q", step: "words" }], plan)).toBeNull();
    expect(pendingRecapCard("words", [], { ...plan, quiz: [] })).toBeNull();
  });

  it("deals the shadowing lines one at a time", () => {
    expect(pendingRecapCard("shadow", [], plan)).toEqual({ kind: "shadow", lineIndex: 0 });
    const open: RecapItem[] = [{ kind: "shadow", id: "s", step: "shadow", lineIndex: 0 }];
    expect(pendingRecapCard("shadow", open, plan)).toBeNull();
    const done: RecapItem[] = [{ kind: "shadow", id: "s", step: "shadow", lineIndex: 0, outcome: { lineNumber: 1, arabic: "x", score: 80 } }];
    expect(pendingRecapCard("shadow", done, plan)).toEqual({ kind: "shadow", lineIndex: 1 });
  });

  it("owes nothing on the conversational steps", () => {
    expect(pendingRecapCard("yesterday", [], plan)).toBeNull();
    expect(pendingRecapCard("slips", [], plan)).toBeNull();
  });
});

describe("nextRecapStep", () => {
  it("walks the plan's steps and stops at the end", () => {
    expect(nextRecapStep(["yesterday", "words", "recap"], "yesterday")).toBe("words");
    expect(nextRecapStep(["yesterday", "words", "recap"], "recap")).toBeNull();
    expect(nextRecapStep(["yesterday", "recap"], "shadow")).toBeNull();
  });
});

describe("recapClock", () => {
  it("tells the server the local date and an east-positive offset", () => {
    const now = new Date(2026, 9, 5, 0, 30); // local midnight-and-a-half, 5 October
    const clock = recapClock(now);
    expect(clock.localDate).toBe("2026-10-05");
    // `+ 0` folds a UTC machine's -0 into 0, which is what the clock sends.
    expect(clock.tzOffsetMinutes).toBe(-now.getTimezoneOffset() + 0);
  });
});

describe("recapOutcome and recapWordsToReview", () => {
  it("reports the card results and the steps reached", () => {
    const items: RecapItem[] = [
      { kind: "quiz", id: "4", step: "words", outcomes: [{ arabic: "تعبان", english: "tired", correct: false, chosen: "happy" }] },
      { kind: "shadow", id: "6", step: "shadow", lineIndex: 0, outcome: { lineNumber: 2, arabic: "x", score: 70 } },
    ];
    expect(recapOutcome(items, new Set(["yesterday", "words"]))).toEqual({
      quiz: [{ arabic: "تعبان", english: "tired", correct: false, chosen: "happy" }],
      shadow: [{ lineNumber: 2, arabic: "x", score: 70 }],
      stepsDone: ["yesterday", "words"],
    });
  });

  it("lists the missed words, saved ones first", () => {
    const outcomes = [
      { arabic: "البارحة", english: "last night", correct: false },
      { arabic: "تعبان", english: "tired", correct: false },
    ];
    expect(recapWordsToReview([tired, lastNight], outcomes).map((q) => q.arabic)).toEqual(["تعبان", "البارحة"]);
    expect(recapWordsToReview([tired, lastNight], undefined)).toEqual([]);
  });
});

describe("the strip", () => {
  const decision = { routeAllowed: true, isAuthenticated: true, summary, dismissed: false, completedToday: false };

  it("shows for a signed-in learner with something to go over", () => {
    expect(shouldShowRecapNudge(decision)).toBe(true);
  });

  it("stays off while the summary is loading, and when there is nothing in it", () => {
    expect(shouldShowRecapNudge({ ...decision, summary: undefined })).toBe(false);
    expect(shouldShowRecapNudge({ ...decision, summary: { ...summary, hasContent: false } })).toBe(false);
  });

  it("stays off where chrome does not belong, and for a visitor", () => {
    expect(shouldShowRecapNudge({ ...decision, routeAllowed: false })).toBe(false);
    expect(shouldShowRecapNudge({ ...decision, isAuthenticated: false })).toBe(false);
  });

  it("goes away for the day once the recap is done or waved off", () => {
    expect(shouldShowRecapNudge({ ...decision, summary: { ...summary, status: "completed" } })).toBe(false);
    expect(shouldShowRecapNudge({ ...decision, completedToday: true })).toBe(false);
    expect(shouldShowRecapNudge({ ...decision, dismissed: true })).toBe(false);
  });

  it("remembers a dismissal for that day only", () => {
    expect(isRecapNudgeDismissed("2026-10-05")).toBe(false);
    dismissRecapNudge("2026-10-05");
    expect(isRecapNudgeDismissed("2026-10-05")).toBe(true);
    expect(isRecapNudgeDismissed("2026-10-06")).toBe(false);
  });

  it("titles the session by its window", () => {
    expect(recapTitle(1)).toBe("Yesterday's recap");
    expect(recapTitle(7)).toBe("This week's recap");
  });
});
