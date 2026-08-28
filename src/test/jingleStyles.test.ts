import { describe, expect, it } from "vitest";
import {
  getJingleStyle,
  getJingleStyleLine,
} from "../../supabase/functions/_shared/jingleStyles.ts";

describe("jingleStyles", () => {
  it("gives Egyptian words an Egyptian pop/shaabi style", () => {
    const { style } = getJingleStyle("Egyptian");
    expect(style).toMatch(/Egyptian/i);
    expect(style).toMatch(/shaabi|mahraganat/i);
  });

  it("forbids Gulf drift for Egyptian, and Egyptian drift for Gulf", () => {
    expect(getJingleStyle("Egyptian").avoid).toMatch(/Khaliji|Gulf/i);
    expect(getJingleStyle("Gulf").avoid).toMatch(/shaabi|Egyptian/i);
  });

  it("defaults unknown dialects to Gulf", () => {
    expect(getJingleStyleLine("Martian")).toBe(getJingleStyleLine("Gulf"));
  });

  it("keeps Yemeni folk-pop distinct", () => {
    expect(getJingleStyle("Yemeni").style).toMatch(/Yemeni/i);
    expect(getJingleStyle("Yemeni").avoid).toMatch(/Gulf/i);
  });

  it("combines style and avoid into one line", () => {
    const line = getJingleStyleLine("Egyptian");
    expect(line).toContain(getJingleStyle("Egyptian").style);
    expect(line).toContain(getJingleStyle("Egyptian").avoid);
  });
});
