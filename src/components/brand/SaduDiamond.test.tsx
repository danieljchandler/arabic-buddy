import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SaduDiamond } from "./SaduDiamond";

/**
 * The Ink direction's small sadu accent. The owner allowed sadu as small
 * marks only — 6 to 14px, never an emblem — so the size clamp is the rule
 * this pins, along with the two things that make it an accent rather than a
 * picture: it takes the surrounding text colour, and assistive tech skips it.
 */

const svg = (ui: React.ReactElement) => render(ui).container.querySelector("svg")!;

describe("SaduDiamond", () => {
  it("is a decorative stepped diamond in currentColor, with an eye", () => {
    const el = svg(<SaduDiamond />);
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("width", "10");
    expect(el).toHaveAttribute("viewBox", "0 0 7 7");
    const path = el.querySelector("path")!;
    expect(path).toHaveAttribute("fill", "currentColor");
    // Stepped, not a rotated square: whole-cell moves only.
    expect(path.getAttribute("d")).toMatch(/^M3 0h1v1h1v1h1v1h1v1/);
    // The eye is a second sub-path, punched out by evenodd.
    expect(path).toHaveAttribute("fill-rule", "evenodd");
    expect(path.getAttribute("d")).toContain("M3 3h1v1h-1z");
  });

  it("fills the eye when asked, for bullets too small to show it", () => {
    const d = svg(<SaduDiamond solid />).querySelector("path")!.getAttribute("d")!;
    expect(d).not.toContain("M3 3h1v1h-1z");
  });

  it("stays between 6 and 14px whatever it is asked for", () => {
    expect(svg(<SaduDiamond size={2} />)).toHaveAttribute("width", "6");
    expect(svg(<SaduDiamond size={40} />)).toHaveAttribute("height", "14");
    expect(svg(<SaduDiamond size={12} />)).toHaveAttribute("width", "12");
  });

  it("passes a class through for colour and placement", () => {
    expect(svg(<SaduDiamond className="text-primary" />).getAttribute("class")).toContain("text-primary");
  });
});
