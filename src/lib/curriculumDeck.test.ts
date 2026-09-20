import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CURRICULUM_DECK_SCOPE,
  isRequestedCurriculumWord,
  loadCurriculumDeckScope,
  saveCurriculumDeckScope,
  selectRequestedCurriculumWords,
  subscribeCurriculumDeckScope,
  type CurriculumDeckRequest,
} from "./curriculumDeck";

const request = (over: Partial<CurriculumDeckRequest> = {}): CurriculumDeckRequest => ({
  reviewedWordIds: new Set<string>(),
  startedLessonIds: new Set<string>(),
  scope: "requested",
  ...over,
});

describe("isRequestedCurriculumWord", () => {
  it("leaves a word from a lesson the learner never opened out of the deck", () => {
    // The whole point. Signing up used to be enough to be served every word in
    // the dialect, mixed in with the learner's own collected vocabulary.
    expect(
      isRequestedCurriculumWord({ id: "w1", lesson_id: "l1" }, request()),
    ).toBe(false);
  });

  it("admits a word whose lesson the learner has started", () => {
    expect(
      isRequestedCurriculumWord(
        { id: "w1", lesson_id: "l1" },
        request({ startedLessonIds: new Set(["l1"]) }),
      ),
    ).toBe(true);
  });

  it("admits a word the learner has already rated, whatever its lesson", () => {
    // A review row is a live FSRS schedule. Dropping one would lose history,
    // not merely decline to add a card — so this holds even for a word from a
    // lesson that has no progress row at all (mixed review, a legacy topic).
    expect(
      isRequestedCurriculumWord(
        { id: "w1", lesson_id: null },
        request({ reviewedWordIds: new Set(["w1"]) }),
      ),
    ).toBe(true);
  });

  it("keeps a topic-backed word out until it has been reviewed", () => {
    // Legacy topics have no lesson_progress row to be started by: lesson_id is
    // null and `startedLessonIds` can never vouch for them.
    expect(
      isRequestedCurriculumWord(
        { id: "w1", lesson_id: null },
        request({ startedLessonIds: new Set(["l1"]) }),
      ),
    ).toBe(false);
  });

  it("admits everything under the 'everything' scope", () => {
    expect(
      isRequestedCurriculumWord({ id: "w1", lesson_id: "l1" }, request({ scope: "everything" })),
    ).toBe(true);
  });
});

describe("selectRequestedCurriculumWords", () => {
  const words = [
    { id: "started", lesson_id: "l1" },
    { id: "untouched", lesson_id: "l2" },
    { id: "rated", lesson_id: "l2" },
    { id: "legacy", lesson_id: null },
  ];

  it("keeps only the asked-for words, in the order given", () => {
    expect(
      selectRequestedCurriculumWords(
        words,
        request({
          startedLessonIds: new Set(["l1"]),
          reviewedWordIds: new Set(["rated"]),
        }),
      ).map((w) => w.id),
    ).toEqual(["started", "rated"]);
  });

  it("passes the whole list through under the 'everything' scope", () => {
    expect(
      selectRequestedCurriculumWords(words, request({ scope: "everything" })).map((w) => w.id),
    ).toEqual(["started", "untouched", "rated", "legacy"]);
  });

  it("does not hand back the caller's array", () => {
    const passed = selectRequestedCurriculumWords(words, request({ scope: "everything" }));
    expect(passed).not.toBe(words);
  });
});

describe("the stored scope", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults to 'requested' when nothing has been chosen", () => {
    expect(loadCurriculumDeckScope()).toBe("requested");
    expect(DEFAULT_CURRICULUM_DECK_SCOPE).toBe("requested");
  });

  it("round-trips a choice", () => {
    saveCurriculumDeckScope("everything");
    expect(loadCurriculumDeckScope()).toBe("everything");
    saveCurriculumDeckScope("requested");
    expect(loadCurriculumDeckScope()).toBe("requested");
  });

  it("reads anything unrecognised as the default", () => {
    localStorage.setItem("hakiya:curriculum-deck-scope", "all-of-it");
    expect(loadCurriculumDeckScope()).toBe("requested");
  });

  it("falls back to the default when storage throws", () => {
    // Private browsing and blocked site data both throw here. Failing closed
    // is what matters: an unreadable preference must not enrol the learner in
    // the whole curriculum.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadCurriculumDeckScope()).toBe("requested");
  });

  it("notifies subscribers on a save, and stops on unsubscribe", () => {
    const seen = vi.fn();
    const stop = subscribeCurriculumDeckScope(seen);
    saveCurriculumDeckScope("everything");
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    saveCurriculumDeckScope("requested");
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
