import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCelebrationPrefs } from "./useCelebrationPrefs";

afterEach(() => localStorage.clear());

describe("useCelebrationPrefs", () => {
  it("starts on and flips with the switch", () => {
    const { result } = renderHook(() => useCelebrationPrefs());
    expect(result.current.enabled).toBe(true);

    act(() => result.current.setEnabled(false));

    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem("hakiya:celebration-songs-enabled")).toBe("false");
  });

  it("follows a change made elsewhere, such as another component or tab", () => {
    const { result } = renderHook(() => useCelebrationPrefs());

    act(() => {
      localStorage.setItem("hakiya:celebration-songs-enabled", "false");
      window.dispatchEvent(new CustomEvent("hakiya:celebration-prefs-changed"));
    });

    expect(result.current.enabled).toBe(false);
  });
});
