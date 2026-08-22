import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MARK_WIDTH_PERCENT, SaduMark } from "./SaduMark";

/**
 * The framed mark.
 *
 * The component is thin — two images stacked — so the things worth guarding
 * are the relationship between them and the artwork they come from. Both
 * frames are traced output, the kind of file someone re-exports without
 * noticing what it cost to get.
 */

const SAND = readFileSync("src/assets/sadu-frame-sand.svg", "utf8");
const CLEAR = readFileSync("src/assets/sadu-frame.svg", "utf8");

/** The band's inner edge, read off the annulus the frame is drawn with. */
const innerRadius = (svg: string) =>
  Number(svg.match(/A(\d+\.?\d*) \1 0 1 0/g)?.slice(-1)[0]?.match(/[\d.]+/)?.[0] ?? NaN);

describe("SaduMark", () => {
  it("is ornament unless it is given a label", () => {
    const { container, rerender } = render(<SaduMark />);
    expect(container.querySelector("span")).toHaveAttribute("aria-hidden", "true");

    rerender(<SaduMark title="Hakiya" />);
    const labelled = container.querySelector("span");
    expect(labelled).toHaveAttribute("role", "img");
    expect(labelled).toHaveAttribute("aria-label", "Hakiya");
    expect(labelled).not.toHaveAttribute("aria-hidden");
  });

  it("composites the mark in rather than baking it into the frames", () => {
    // The logo has one source of truth on disk. If the frames ever carry the
    // mark themselves, cleaning it up means editing artwork in three places
    // and the three will drift.
    const { container } = render(<SaduMark />);
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));

    expect(srcs).toHaveLength(2);
    expect(srcs.some((s) => s?.includes("hakiya-mark"))).toBe(true);
    expect(SAND).not.toContain("<image");
    expect(CLEAR).not.toContain("<image");
  });

  it("defaults to the ground-bearing frame", () => {
    // `clear` is the one that fails on a dark surface — the mark's outline is
    // near-black and needs something light to be dark against. Defaulting to
    // it would put the broken case in every slot that forgets the prop.
    const { container, rerender } = render(<SaduMark />);
    const first = container.querySelector("img")?.getAttribute("src");

    rerender(<SaduMark variant="clear" />);
    expect(container.querySelector("img")?.getAttribute("src")).not.toBe(first);
  });

  it("takes its size from the caller", () => {
    const { container } = render(<SaduMark className="h-10 w-10" />);
    expect(container.querySelector("span")).toHaveClass("h-10", "w-10");
  });
});

describe("the sadu-frame artwork", () => {
  it("leaves the mark clearance inside the band", () => {
    // The mark is sized as a percentage of the box, the opening is a radius in
    // the artwork, and nothing in the type system connects the two. Crowding
    // the band is what makes a framed mark look like a sticker.
    const opening = (innerRadius(SAND) / 32) * 100; // as a % of the box's width
    expect(opening).toBeGreaterThan(MARK_WIDTH_PERCENT + 8);
  });

  it("differs from the clear frame only by the ground", () => {
    // Same band, same radii — the two variants must stay the same object with
    // and without a floor, or `clear` quietly becomes a different mark.
    expect(innerRadius(CLEAR)).toBeCloseTo(innerRadius(SAND), 1);
    expect(SAND).toContain('fill="#F2E7D5"');
    expect(CLEAR).not.toContain("#F2E7D5");
  });

  it("keeps the traced band rather than a simplified stand-in", () => {
    // A repeat built by hand is a fraction of the size and does not look like
    // the artwork that was chosen. If this collapses, someone has "optimised"
    // it into one.
    const weft = SAND.match(/<path d="([^"]+)" fill="#FAE7C7"/)?.[1] ?? "";
    expect(weft.length).toBeGreaterThan(20_000);
    expect(weft).toContain("C");
  });
});
