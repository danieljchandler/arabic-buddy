import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setBrandPreview } from "@/lib/brandPreview";
import { EmptyState, type EmptyStateProps } from "./EmptyState";

/**
 * What a screen says when it has nothing to show.
 *
 * By default the plate is painted art, one piece per kind of absence. Under
 * the Ink brand preview there are no pictures, so the plate becomes a letter
 * — the first of a spoken word naming the absence — with a small sadu
 * diamond. Either way the title, the body and the way out are the same, and
 * the plate is decoration that assistive tech skips.
 */

afterEach(() => {
  act(() => setBrandPreview(null));
});

const ARTS: NonNullable<EmptyStateProps["art"]>[] = [
  "caught-up",
  "nothing-yet",
  "no-lessons",
  "no-rankings",
  "no-phrases",
  "no-results",
];

describe("EmptyState", () => {
  it("says what is missing and offers the way out", () => {
    render(<EmptyState title="No words yet" body="Save one from any clip." action={<button>Browse clips</button>} />);
    expect(screen.getByRole("heading", { name: "No words yet" })).toBeInTheDocument();
    expect(screen.getByText("Save one from any clip.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse clips" })).toBeInTheDocument();
  });

  it("takes its actions as children too, and can go without a body", () => {
    const { container } = render(
      <EmptyState title="Nothing here">
        <button>Start</button>
      </EmptyState>,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
  });

  it("paints a distinct, hidden plate for each kind of absence", () => {
    const srcs = ARTS.map((art) => {
      const { container, unmount } = render(<EmptyState art={art} title="t" />);
      const img = container.querySelector("img")!;
      expect(img).toHaveAttribute("aria-hidden");
      expect(img).toHaveAttribute("alt", "");
      const src = img.getAttribute("src");
      unmount();
      return src;
    });
    expect(new Set(srcs).size).toBe(ARTS.length);
  });

  it("sizes the plate for a page or an inline empty", () => {
    const { container, rerender } = render(<EmptyState title="t" />);
    expect(container.querySelector("img")!.className).toContain("h-36");
    rerender(<EmptyState title="t" size="sm" />);
    expect(container.querySelector("img")!.className).toContain("h-24");
  });

  describe("under the Ink preview", () => {
    it("sets a letter on a paper plate instead of the painting", () => {
      act(() => setBrandPreview("ink"));
      const { container } = render(<EmptyState art="caught-up" title="All caught up" body="Come back later." />);

      expect(container.querySelector("img")).toBeNull();
      const plate = container.querySelector("[data-ink-plate]")!;
      expect(plate).toHaveAttribute("aria-hidden", "true");
      expect(plate).toHaveAttribute("data-ink-plate", "caught-up");
      expect(plate.className).toContain("bg-muted");
      // ممتاز — a dotless letter, so the plate can't be misread in Rakkas.
      expect(plate).toHaveTextContent("م");
      expect(plate).toHaveTextContent("ممتاز");
      expect(plate.querySelector("[data-sadu-diamond]")).not.toBeNull();

      // The words are untouched.
      expect(screen.getByRole("heading", { name: "All caught up" })).toBeInTheDocument();
      expect(screen.getByText("Come back later.")).toBeInTheDocument();
    });

    it("gives every kind of absence its own letter", () => {
      act(() => setBrandPreview("ink"));
      const letters = ARTS.map((art) => {
        const { container, unmount } = render(<EmptyState art={art} title="t" />);
        const letter = container.querySelector(".font-ink-display")!.textContent;
        unmount();
        return letter;
      });
      expect(new Set(letters).size).toBe(ARTS.length);
    });

    it("scales the plate, letter and diamond down for an inline empty", () => {
      act(() => setBrandPreview("ink"));
      const { container } = render(<EmptyState title="t" size="sm" />);
      const plate = container.querySelector("[data-ink-plate]")!;
      expect(plate.className).toContain("h-24");
      expect(plate.querySelector(".font-ink-display")!.className).toContain("text-[56px]");
      expect(plate.querySelector("svg")).toHaveAttribute("width", "8");
    });
  });
});
