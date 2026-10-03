import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BRAND_DEFAULT_ATTRIBUTE, setBrandPreview } from "@/lib/brandPreview";
import { BrandMark } from "./BrandMark";

/**
 * The corner mark.
 *
 * Under Ink — the default brand index.html declares, or a preview — it is
 * the redrawn Ink mark, and on the feed ("/"), which keeps its square corner
 * tile, the Ink app icon at the same footprint. On the previous look it is
 * the supplied lockup raster. The accessible name is "Hikaya" in every case;
 * shell.spec and feed.spec find the mark by it.
 */

afterEach(() => {
  act(() => setBrandPreview(null));
  document.documentElement.removeAttribute(BRAND_DEFAULT_ATTRIBUTE);
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BrandMark />
    </MemoryRouter>,
  );

describe("BrandMark", () => {
  it("is the lockup raster on the previous look (no default declared)", () => {
    renderAt("/choose");
    const mark = screen.getByRole("img", { name: "Hikaya" });
    expect(mark.tagName).toBe("IMG");
    expect(mark.getAttribute("src")).toMatch(/lockup/);
    expect(mark).toHaveAttribute("draggable", "false");
  });

  it("stays the raster under the other previews and on Current", () => {
    for (const state of ["weave", "souq", "current"] as const) {
      act(() => setBrandPreview(state));
      const { unmount } = renderAt("/choose");
      expect(screen.getByRole("img", { name: "Hikaya" }).tagName).toBe("IMG");
      unmount();
    }
  });

  it("draws the Ink mark under the Ink preview", () => {
    act(() => setBrandPreview("ink"));
    renderAt("/today");
    const mark = screen.getByRole("img", { name: "Hikaya" });
    expect(mark.tagName).toBe("SPAN");
    // The owner's primary mark, the one with the sadu pressed in.
    expect(mark).toHaveAttribute("data-ink-mark", "sadu");
    // The raster's 48px height, so the corner keeps its footprint.
    expect(mark.querySelector("img")).toHaveAttribute("height", "48");
  });

  it("is the Ink app icon on the feed, at the old tile's 48px footprint", () => {
    act(() => setBrandPreview("ink"));
    renderAt("/");
    const tile = screen.getByRole("img", { name: "Hikaya" });
    expect(tile.tagName).toBe("IMG");
    expect(tile.getAttribute("src")).toMatch(/icon/);
    expect(tile).toHaveClass("h-12", "w-12");
  });

  it("draws the Ink mark with no preview once Ink is the declared default", () => {
    document.documentElement.setAttribute(BRAND_DEFAULT_ATTRIBUTE, "ink");
    renderAt("/choose");
    expect(screen.getByRole("img", { name: "Hikaya" })).toHaveAttribute("data-ink-mark", "sadu");
  });
});
