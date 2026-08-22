import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SaduPlayButton } from "./SaduPlayButton";

/**
 * The feed's play control.
 *
 * The component is a wrapper around one asset, so most of what is worth
 * guarding lives in the asset — and the asset is traced output, which is
 * exactly the kind of file someone re-exports, re-optimises or hand-edits
 * without noticing what it costs. Those checks read it off disk.
 */

const ART = readFileSync("src/assets/sadu-play.svg", "utf8");

/** Every fill/stroke colour in the file, in source order. */
const colours = ART.match(/#[0-9A-Fa-f]{6}/g) ?? [];
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
};

describe("SaduPlayButton", () => {
  it("is ornament, not something a screen reader announces", () => {
    const { container } = render(<SaduPlayButton />);

    // It sits inside a button that already carries "Play <title>", so an alt
    // text or a missing aria-hidden would be announced on top of that.
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("aria-hidden", "true");
    expect(img).toHaveAttribute("alt", "");
  });

  it("takes its size from the caller", () => {
    const { container } = render(<SaduPlayButton className="h-16 w-16" />);

    // The art is a viewBox with no intrinsic size, so a caller that forgets to
    // pass one gets a zero-height button rather than a small one.
    expect(container.querySelector("img")).toHaveClass("h-16", "w-16");
  });
});

describe("the sadu-play artwork", () => {
  it("keeps the weave pressed rather than printed", () => {
    // The ground and the weave are two charcoals a few points apart. That gap
    // is the entire design — it is what makes this texture you sense instead
    // of pattern you read, and it is what someone will "fix" the first time
    // they look at this on a bright monitor. The loud version was already
    // tried and rejected; it is kept at docs/branding/sadu-cloth-disc.svg.
    expect(colours.length).toBeGreaterThanOrEqual(2);
    const [ground = "", weave = ""] = colours;
    const gap = luminance(weave) - luminance(ground);

    expect(gap).toBeGreaterThan(0); // the weave is the lighter of the two
    expect(gap).toBeLessThan(40); // and only just
    expect(luminance(ground)).toBeLessThan(40); // on glass, not on paper
  });

  it("carries the brand in one hairline and nothing else", () => {
    // The crimson rim is the only colour on the button. It is 0.31 units — a
    // third of a pixel at feed size — which looks like a mistake in the source
    // and is measured off the artwork, where it renders as a fine red edge.
    const rim = ART.match(/stroke="#8A1520"\s+stroke-width="([\d.]+)"/);
    expect(rim).not.toBeNull();
    expect(Number(rim?.[1])).toBeLessThan(1);

    // Nothing else is crimson, and the glyph is the one bright thing.
    expect(colours.filter((c) => c.toUpperCase() === "#8A1520")).toHaveLength(1);
    expect(colours.filter((c) => luminance(c) > 200)).toHaveLength(1);
  });

  it("keeps the traced weave rather than a simplified stand-in", () => {
    // The hand-built tile this replaced was a tenth of the size and did not
    // look like the artwork anyone signed off. If this file ever collapses to
    // a few hundred bytes, someone has "optimised" it back into that.
    const weave = ART.match(/<path d="([^"]+)" fill="#26221F"/)?.[1] ?? "";
    expect(weave.length).toBeGreaterThan(8000);

    // Traced curves, not a tile: straight-line-only output means the file was
    // re-exported through something that flattened it.
    expect(weave).toContain("C");
  });

  it("stays small enough to be worth shipping as one cached asset", () => {
    // It is fetched once and shared by every card. That is only a good trade
    // while it stays in this range — past it, revisit the decision rather than
    // quietly shipping a heavier button.
    expect(ART.length).toBeLessThan(40_000);
  });
});
