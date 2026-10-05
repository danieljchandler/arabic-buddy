import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadCelebrationSongsEnabled,
  saveCelebrationSongsEnabled,
  subscribeCelebrationPrefs,
} from "./celebrationPrefs";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("celebration songs preference", () => {
  it("is on until the learner turns it off", () => {
    expect(loadCelebrationSongsEnabled()).toBe(true);
  });

  it("remembers an explicit choice either way", () => {
    saveCelebrationSongsEnabled(false);
    expect(loadCelebrationSongsEnabled()).toBe(false);
    saveCelebrationSongsEnabled(true);
    expect(loadCelebrationSongsEnabled()).toBe(true);
  });

  it("tells subscribers when it changes, and stops when unsubscribed", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeCelebrationPrefs(cb);

    saveCelebrationSongsEnabled(false);
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    saveCelebrationSongsEnabled(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("falls back to on when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadCelebrationSongsEnabled()).toBe(true);
  });
});
