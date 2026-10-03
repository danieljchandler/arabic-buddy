import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BRAND_DEFAULT_ATTRIBUTE, setBrandPreview, setMarkVariant } from "@/lib/brandPreview";
import { useBrandPreview, useInkMarkVariant, useIsInk } from "./useBrandPreview";

/**
 * useBrandPreview / useIsInk / useInkMarkVariant.
 *
 * What matters is the default: with no preview active every component asking
 * gets `null` / `false` / `"sadu"` (the owner's primary mark), which is what
 * keeps the Ink branches out of the tree for everyone who never opened a
 * `?brand=` link. Past that, the
 * hooks must follow the store live — the switcher flips the direction without
 * a reload, and a tile that kept rendering the old branch would make the
 * comparison it exists for meaningless.
 */

afterEach(() => {
  act(() => setBrandPreview(null));
  localStorage.clear();
  document.documentElement.removeAttribute(BRAND_DEFAULT_ATTRIBUTE);
});

describe("useBrandPreview", () => {
  it("is the previous look, not ink, with the primary (sadu) mark when no default is declared", () => {
    const { result } = renderHook(() => ({
      preview: useBrandPreview(),
      ink: useIsInk(),
      mark: useInkMarkVariant(),
    }));
    expect(result.current).toEqual({ preview: "current", ink: false, mark: "sadu" });
  });

  it("is Ink with no preview at all once index.html declares it the default", () => {
    document.documentElement.setAttribute(BRAND_DEFAULT_ATTRIBUTE, "ink");
    const { result } = renderHook(() => ({ preview: useBrandPreview(), ink: useIsInk() }));
    expect(result.current).toEqual({ preview: "ink", ink: true });

    // A preview still wins over the default, and ending it comes back to Ink.
    act(() => setBrandPreview("current"));
    expect(result.current).toEqual({ preview: "current", ink: false });
    act(() => setBrandPreview(null));
    expect(result.current).toEqual({ preview: "ink", ink: true });
  });

  it("follows the switcher live", () => {
    const { result } = renderHook(() => ({ preview: useBrandPreview(), ink: useIsInk() }));

    act(() => setBrandPreview("ink"));
    expect(result.current).toEqual({ preview: "ink", ink: true });

    // Another direction, or "current" (previewing today's look), is not Ink.
    act(() => setBrandPreview("weave"));
    expect(result.current).toEqual({ preview: "weave", ink: false });
    act(() => setBrandPreview("current"));
    expect(result.current).toEqual({ preview: "current", ink: false });

    act(() => setBrandPreview(null));
    expect(result.current).toEqual({ preview: "current", ink: false });
  });

  it("follows the mark variant, and drops it when the preview ends", () => {
    act(() => setBrandPreview("ink"));
    const { result } = renderHook(() => useInkMarkVariant());
    expect(result.current).toBe("sadu");

    act(() => setMarkVariant("clean"));
    expect(result.current).toBe("clean");

    act(() => setBrandPreview(null));
    expect(result.current).toBe("sadu");
  });
});
