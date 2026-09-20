import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCurriculumDeckScope } from "./useCurriculumDeckScope";
import { saveCurriculumDeckScope } from "@/lib/curriculumDeck";

/**
 * Whether the authored curriculum is queued for review unasked.
 *
 * The deck this drives is `useDueWords`. Off (the default) a learner's
 * flashcards are the words they collected plus the lessons they opened; on,
 * every curriculum word in the dialect is queued, which is how it used to
 * behave for everybody.
 *
 * Two things this has to get right. It settles in an effect rather than in the
 * state initialiser — the opposite of `useLeechPrefs` — because the value is
 * part of the review query's key, and a first render that disagreed with
 * localStorage would build a deck and immediately throw it away. And it reaches
 * the review screen while it is mounted, because the switch is in Settings.
 */

const KEY = "hakiya:curriculum-deck-scope";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("the starting point", () => {
  it("asks for nothing on behalf of a learner who has never chosen", () => {
    const { result } = renderHook(() => useCurriculumDeckScope());

    expect(result.current.scope).toBe("requested");
  });

  it("picks up a learner who asked for the whole curriculum", () => {
    localStorage.setItem(KEY, "everything");

    const { result } = renderHook(() => useCurriculumDeckScope());

    expect(result.current.scope).toBe("everything");
  });

  it("starts from the default on the very first render", () => {
    localStorage.setItem(KEY, "everything");

    const seen: string[] = [];
    renderHook(() => {
      const { scope } = useCurriculumDeckScope();
      seen.push(scope);
      return scope;
    });

    // The safe direction: a first paint that guessed "everything" and was
    // wrong would have put the whole curriculum in front of the learner.
    expect(seen[0]).toBe("requested");
    expect(seen[seen.length - 1]).toBe("everything");
  });
});

describe("changing it", () => {
  it("persists the choice", () => {
    const { result } = renderHook(() => useCurriculumDeckScope());

    act(() => result.current.setScope("everything"));

    expect(result.current.scope).toBe("everything");
    expect(localStorage.getItem(KEY)).toBe("everything");
  });

  it("reaches a screen that is already mounted", () => {
    const { result } = renderHook(() => useCurriculumDeckScope());

    // Settings and Review are both mounted at once inside the app shell; a
    // switch the review deck only notices on the next full load is a switch
    // that looks broken.
    act(() => saveCurriculumDeckScope("everything"));

    expect(result.current.scope).toBe("everything");
  });

  it("stops listening once unmounted", () => {
    const { result, unmount } = renderHook(() => useCurriculumDeckScope());
    unmount();

    act(() => saveCurriculumDeckScope("everything"));

    expect(result.current.scope).toBe("requested");
  });
});
