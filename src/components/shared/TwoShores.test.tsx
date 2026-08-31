import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TwoShores } from "./TwoShores";

/**
 * The decorative shore band. There is not much logic to pin, so what these
 * tests hold are the three properties a future edit could plausibly break
 * without anyone noticing in review: that it stays out of the accessibility
 * tree and out of the way of the pointer, that both shores are actually drawn,
 * and that it never sizes the art by width — the version that did washed a
 * paragraph of the MSA Bridge header in watercolour, because these images are
 * about twice as wide as they are tall and a percentage width on a wide
 * container made them taller than the band meant to contain them.
 */
describe("TwoShores", () => {
  it("is decoration: hidden from assistive tech and inert to the pointer", () => {
    const { container } = render(<TwoShores />);
    const band = screen.getByTestId("two-shores");

    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(band.className).toContain("pointer-events-none");
    // Empty alt on both, so neither shore is announced as an image either.
    for (const img of container.querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
    }
  });

  it("draws both shores, anchored to opposite bottom corners", () => {
    const { container } = render(<TwoShores />);
    const imgs = Array.from(container.querySelectorAll("img"));

    expect(imgs).toHaveLength(2);
    expect(imgs.some((i) => i.className.includes("left-0"))).toBe(true);
    expect(imgs.some((i) => i.className.includes("right-0"))).toBe(true);
    expect(imgs.every((i) => i.className.includes("bottom-0"))).toBe(true);
  });

  it("sizes the shores by the band's height, with a width cap", () => {
    const { container } = render(<TwoShores />);

    for (const img of container.querySelectorAll("img")) {
      expect(img.className).toContain("h-full");
      expect(img.className).toContain("w-auto");
      // The cap is what keeps open water between the two on a narrow screen.
      expect(img.className).toMatch(/max-w-\[\d+%\]/);
    }
  });

  it("takes the band height from the caller", () => {
    render(<TwoShores height="h-64" />);
    expect(screen.getByTestId("two-shores").className).toContain("h-64");
  });

  it("can drop the crossing for a caller putting something else in the gap", () => {
    const { container: withCrossing } = render(<TwoShores />);
    expect(withCrossing.querySelector("svg")).not.toBeNull();

    const { container: without } = render(<TwoShores crossing={false} />);
    expect(without.querySelector("svg")).toBeNull();
  });
});
