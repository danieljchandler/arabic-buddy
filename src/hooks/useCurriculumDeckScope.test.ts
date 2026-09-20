import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * Two things this has to get right. The stored value is read in the state
 * initialiser, because it is part of `useDueWords`' query key: settling it in
 * an effect fired a deck query under the wrong key first, and since that query
 * doesn't consume TanStack Query's abort signal the discarded read completed
 * and cached an empty `requested` deck for a learner who wanted `everything` —
 * which a later mount would then read, sending `/review` straight past the
 * curriculum on its forwarding `<Navigate>`. And it reaches the review screen
 * while it is mounted, because the switch is in Settings.
 */

const KEY = "hakiya:curriculum-deck-scope";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

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

  it("is known on the very first render", () => {
    localStorage.setItem(KEY, "everything");

    const seen: string[] = [];
    renderHook(() => {
      const { scope } = useCurriculumDeckScope();
      seen.push(scope);
      return scope;
    });

    // Every render, not just the last: one render under the wrong scope is one
    // `due-words` query under the wrong key, and that query's result is cached
    // for five minutes whether or not anything still wants it.
    expect(seen).toEqual(["everything"]);
  });

  it("falls back to the default when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    // Reading in the initialiser means the throw happens during render, so it
    // has to be caught there too — `loadCurriculumDeckScope` does that, and
    // this pins that the hook never propagates it.
    expect(renderHook(() => useCurriculumDeckScope()).result.current.scope).toBe("requested");
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
