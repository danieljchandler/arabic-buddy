import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getThemePref, resolveTheme, useTheme } from "./useTheme";

/**
 * The theme preference — light, dark ("night majlis"), or follow the system.
 *
 * The `.dark` token block existed long before any way to turn it on; this hook
 * is the switch. Two properties carry the design: light is the default (the
 * warm-sand identity is the brand, dark is an opt-in reading mode), and the
 * preference lands as a class on <html> because that is what every `dark:`
 * variant and the token block key off.
 */

const KEY = "hakiya_theme";

/** matchMedia standing in for a device that prefers `dark` when asked to. */
function stubMatchMedia(prefersDark: boolean) {
  const listeners: Array<() => void> = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: prefersDark && query.includes("dark"),
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: () => {},
  }));
  return listeners;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

describe("the starting point", () => {
  it("defaults to light for a learner who has never chosen", () => {
    expect(getThemePref()).toBe("light");
  });

  it("ignores a corrupted stored value rather than crashing the boot path", () => {
    localStorage.setItem(KEY, "neon");
    expect(getThemePref()).toBe("light");
  });

  it("remembers a stored choice", () => {
    localStorage.setItem(KEY, "dark");
    expect(getThemePref()).toBe("dark");
  });
});

describe("resolving 'system'", () => {
  it("follows a device that prefers dark", () => {
    stubMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("follows a device that prefers light", () => {
    stubMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("passes explicit choices through untouched", () => {
    stubMatchMedia(true);
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
});

describe("stamping the document", () => {
  it("adds the class the dark tokens key off", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes it again for light", () => {
    document.documentElement.classList.add("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("changing the preference", () => {
  it("persists and applies in one act", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setPref("dark"));

    expect(localStorage.getItem(KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(result.current.resolved).toBe("dark");
  });

  it("returns to warm sand when asked", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setPref("dark"));
    act(() => result.current.setPref("light"));

    expect(localStorage.getItem(KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("re-stamps the document when the system preference changes underneath 'system'", () => {
    const listeners = stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setPref("system"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // The device flips to dark; the listener registered for 'system' re-applies.
    stubMatchMedia(true);
    act(() => listeners.forEach((fn) => fn()));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
