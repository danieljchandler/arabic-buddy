import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DialectFrame } from "./DialectFrame";
import { TITLE_MAX_SIZE, titleFontSize } from "./frameTitle";

/**
 * The dance's name, framed in its dialect's architecture. Each frame is a
 * different drawing around the same title area, so what is pinned here is
 * that each dialect gets its own, that the title is there to read, and that
 * a long name shrinks instead of running off the paper.
 */

const drawing = (dialect: "Gulf" | "Egyptian" | "Yemeni") => {
  const { container } = render(<DialectFrame dialect={dialect} title="العرضة" />);
  return container.querySelector("svg")!;
};

describe("DialectFrame", () => {
  it("draws a different frame for each dialect", () => {
    const shapes = (["Gulf", "Egyptian", "Yemeni"] as const).map((d) => drawing(d).innerHTML.replace(/cel-[a-z]+-[^"')]+/g, ""));
    expect(new Set(shapes).size).toBe(3);
  });

  it("carries the title in each, hidden from screen readers (the stage names the dance)", () => {
    for (const dialect of ["Gulf", "Egyptian", "Yemeni"] as const) {
      const svg = drawing(dialect);
      expect(svg.querySelector("text")?.textContent).toBe("العرضة");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("gives the Egyptian frame its lattice and the Yemeni one its coloured glass", () => {
    expect(drawing("Egyptian").querySelector("pattern")).not.toBeNull();
    expect(drawing("Yemeni").querySelectorAll("path[stroke]").length).toBeGreaterThanOrEqual(6);
  });
});

describe("titleFontSize", () => {
  it("keeps a short name at full size", () => {
    expect(titleFontSize("العرضة")).toBe(TITLE_MAX_SIZE);
    expect(titleFontSize("العيالة")).toBe(TITLE_MAX_SIZE);
  });

  it("shrinks a long one", () => {
    expect(titleFontSize("رقص العصاية")).toBeLessThan(TITLE_MAX_SIZE);
    expect(titleFontSize("رقص العصاية")).toBeGreaterThan(30);
  });

  it("doesn't count diacritics, which take no width", () => {
    expect(titleFontSize("البَرَع")).toBe(titleFontSize("البرع"));
  });
});
