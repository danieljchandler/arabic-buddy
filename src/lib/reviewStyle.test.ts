import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REVIEW_STYLE,
  isReviewStyle,
  loadReviewStyle,
  saveReviewStyle,
  subscribeReviewStyle,
} from "./reviewStyle";

/**
 * The device-local half of "how you review".
 *
 * It defaults to flashcards, so the review loop every existing learner knows
 * is untouched until they choose otherwise, and an unreadable or corrupt store
 * must land on the same default rather than on the quiz — a learner who never
 * asked to be quizzed must not be. The subscription is what lets the switch
 * in the review page header and the row in Settings agree while both are
 * mounted, and the `storage` listener is what carries a change across tabs.
 */

const KEY = "hakiya:review-style";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recognising a style", () => {
  it("accepts the two styles and nothing else", () => {
    expect(isReviewStyle("flashcards")).toBe(true);
    expect(isReviewStyle("quiz")).toBe(true);
    expect(isReviewStyle("mix")).toBe(false);
    expect(isReviewStyle(null)).toBe(false);
    expect(isReviewStyle(1)).toBe(false);
  });
});

describe("reading the preference", () => {
  it("defaults to flashcards when nothing has been stored", () => {
    expect(loadReviewStyle()).toBe("flashcards");
    expect(DEFAULT_REVIEW_STYLE).toBe("flashcards");
  });

  it("reads a stored quiz", () => {
    window.localStorage.setItem(KEY, "quiz");
    expect(loadReviewStyle()).toBe("quiz");
  });

  it("treats an unrecognised value as the default", () => {
    // A value an older build might have written, or a typo: never the quiz.
    window.localStorage.setItem(KEY, "games");
    expect(loadReviewStyle()).toBe("flashcards");
  });

  it("falls back to the default when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadReviewStyle()).toBe("flashcards");
  });
});

describe("writing the preference", () => {
  it("stores the style and reads it back", () => {
    saveReviewStyle("quiz");
    expect(window.localStorage.getItem(KEY)).toBe("quiz");
    expect(loadReviewStyle()).toBe("quiz");
  });

  it("round-trips back to flashcards", () => {
    saveReviewStyle("quiz");
    saveReviewStyle("flashcards");
    expect(loadReviewStyle()).toBe("flashcards");
  });

  it("does not throw when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveReviewStyle("quiz")).not.toThrow();
  });
});

describe("subscribing", () => {
  it("fires when the preference is saved", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReviewStyle(listener);

    saveReviewStyle("quiz");

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("fires when another tab changes it", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReviewStyle(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "quiz" }));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops firing once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReviewStyle(listener);

    unsubscribe();
    saveReviewStyle("quiz");
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    expect(listener).not.toHaveBeenCalled();
  });
});
