import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SaduPlayButton } from "./SaduPlayButton";

/**
 * The feed's play control: a disc of Sadu cloth with the play glyph cut out of
 * it. Four things here are worth holding down, because each is easy to undo by
 * accident and none of them shows up as a broken build.
 */

describe("SaduPlayButton", () => {
  it("is ornament, not something a screen reader announces", () => {
    const { container } = render(<SaduPlayButton />);

    // It is ornament inside a button that already carries "Play <title>", so
    // anything the SVG contributed to the accessible name would be read out on
    // top of that.
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // Nothing inside it is focusable either — the button around it takes the tab.
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("cuts the glyph out of the cloth rather than laying one on top", () => {
    const { container } = render(<SaduPlayButton />);

    // The disc is painted through a clip of "circle minus triangle", so the
    // frame behind shows through the glyph while the clip plays. Painting the
    // disc solid and dropping a cream triangle on it looks identical on a
    // still and loses the whole idea in motion, so the clip is the thing to
    // guard: one path, two subpaths, evenodd.
    const clip = container.querySelector('clipPath > path[clip-rule="evenodd"]');
    expect(clip).not.toBeNull();

    const d = clip?.getAttribute("d") ?? "";
    expect(d).toMatch(/A31\.4 31\.4/); // the disc
    expect(d).toContain("M25.6 21.6L44.8 32L25.6 42.4Z"); // the glyph, subtracted

    // And nothing fills the glyph. Every path drawn on the triangle is a
    // stroke; a fill on any of them would plug the hole.
    const onGlyph = container.querySelectorAll('path[d="M25.6 21.6L44.8 32L25.6 42.4Z"]');
    expect(onGlyph.length).toBeGreaterThan(0);
    onGlyph.forEach((path) => expect(path).toHaveAttribute("fill", "none"));
  });

  it("keeps the crimson moat that separates the glyph from the weave", () => {
    const { container } = render(<SaduPlayButton />);

    // Over a bright frame the cut fills with something close to the cream in
    // the weave, and without a band of ground colour around it the triangle
    // stops reading as a triangle. It looks redundant on a dark still, which
    // is exactly why someone will delete it.
    const moat = Array.from(
      container.querySelectorAll('path[d="M25.6 21.6L44.8 32L25.6 42.4Z"]'),
    ).find((path) => path.getAttribute("stroke") === "#8A1520");

    expect(moat).toBeDefined();
    expect(Number(moat?.getAttribute("stroke-width"))).toBeGreaterThan(3);
  });

  it("gives every instance its own ids", () => {
    // The feed renders one of these per card. Constant ids would put duplicates
    // in the document, and then every button after the first is painted by the
    // first one's <pattern> — fine until that card unmounts on scroll.
    const { container } = render(
      <>
        <SaduPlayButton />
        <SaduPlayButton />
      </>,
    );

    const ids = Array.from(container.querySelectorAll("[id]")).map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);

    // And each instance points at its own, rather than both resolving to the
    // first pair by document order.
    const refs = Array.from(container.querySelectorAll("g[clip-path]")).map((g) =>
      g.getAttribute("clip-path"),
    );
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("takes its size from the caller", () => {
    const { container } = render(<SaduPlayButton className="h-16 w-16" />);

    // The art is a viewBox with no intrinsic size, so a caller that forgets to
    // pass one gets a zero-height button rather than a small one.
    expect(container.querySelector("svg")).toHaveClass("h-16", "w-16");
  });
});
