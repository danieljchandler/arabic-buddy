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
  it("cuts the glyph out of the cloth rather than laying one on top", () => {
    // The disc is painted through a clip of "circle minus triangle", so the
    // frame behind shows through the glyph while the clip plays. Painting the
    // disc solid and dropping a cream triangle on it looks identical on a
    // still and loses the whole idea in motion.
    expect(ART).toContain('clip-rule="evenodd"');

    // Two subpaths in the clip: the disc, then the glyph subtracted from it.
    const clip = ART.match(/<clipPath[\s\S]*?<path d="([^"]+)"/)?.[1] ?? "";
    expect(clip).toMatch(/A31\.4 31\.4/); // the disc
    expect(clip.match(/M/g)?.length).toBeGreaterThan(1); // and something taken out of it

    // Everything that paints is inside that clip. A fill outside it would sit
    // over the glyph.
    expect(ART).toMatch(/<g clip-path="url\(#cloth\)">[\s\S]*<\/g>\s*<\/svg>/);
  });

  it("keeps the traced weave rather than a simplified stand-in", () => {
    // The hand-built <pattern> this replaced was a tenth of the size and did
    // not look like the artwork anyone signed off. If this file ever collapses
    // to a few hundred bytes, someone has "optimised" it back into that.
    const weave = ART.match(/<path d="([^"]+)" fill="#FAE7C7"/)?.[1] ?? "";
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
