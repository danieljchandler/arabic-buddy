import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SaduPlayButton } from "./SaduPlayButton";

/**
 * The feed's play control.
 *
 * Two things here are worth holding down, because both are easy to undo by
 * accident and neither shows up as a broken build.
 *
 * The first is that the art stays decorative. It is ornament sitting inside a
 * button that already carries "Play <title>", so anything the SVG contributed
 * to the accessible name would be read out on top of that.
 *
 * The second is that the middle stays open. The whole reason the ornament is a
 * ring rather than a disc is that the clip behind it shows through; filling the
 * centre would turn a control into a badge covering somebody's video.
 */

describe("SaduPlayButton", () => {
  it("is ornament, not something a screen reader announces", () => {
    const { container } = render(<SaduPlayButton />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // Nothing inside it is focusable either — the button around it takes the tab.
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("keeps the centre open so the frame behind shows through", () => {
    const { container } = render(<SaduPlayButton />);

    // The band is an annulus: one path, two circles, evenodd. A fill-rule of
    // anything else makes it a solid disc, which is exactly the failure this
    // guards — and it still *looks* fine in isolation, only wrong over video.
    const band = container.querySelector('path[fill-rule="evenodd"]');
    expect(band).not.toBeNull();

    // The only fill over the middle is the scrim, and it has to stay partial.
    const scrim = container.querySelector('circle[fill-opacity]');
    expect(Number(scrim?.getAttribute("fill-opacity"))).toBeLessThan(0.6);
  });

  it("takes its size from the caller", () => {
    const { container } = render(<SaduPlayButton className="h-16 w-16" />);

    // The art is a viewBox with no intrinsic size, so a caller that forgets to
    // pass one gets a zero-height button rather than a small one.
    expect(container.querySelector("svg")).toHaveClass("h-16", "w-16");
  });
});
