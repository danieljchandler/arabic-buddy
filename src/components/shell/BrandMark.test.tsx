import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { setBrandPreview } from "@/lib/brandPreview";
import { BrandMark } from "./BrandMark";

/**
 * The corner mark.
 *
 * For everyone who has not opted into a brand preview it is the supplied
 * lockup raster and nothing else. Under the Ink preview it is the redrawn
 * Ink mark — except on the feed ("/"), whose brand tile the owner decided to
 * keep exactly as it is. The accessible name is "Hikaya" in every case;
 * shell.spec and feed.spec find the mark by it.
 */

afterEach(() => {
  act(() => setBrandPreview(null));
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BrandMark />
    </MemoryRouter>,
  );

describe("BrandMark", () => {
  it("is the lockup raster for anyone not previewing", () => {
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

  it("leaves the feed's brand tile alone, even under Ink", () => {
    act(() => setBrandPreview("ink"));
    renderAt("/");
    expect(screen.getByRole("img", { name: "Hikaya" }).tagName).toBe("IMG");
  });
});
