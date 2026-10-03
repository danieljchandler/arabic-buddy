import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InkWaveform } from "./InkWaveform";

/**
 * Ink's waveform motif. Decorative, so hidden; deterministic, so a tile looks
 * the same in every render and screenshot; and clamped, so a bar never
 * vanishes or overflows its box.
 */
const root = (ui: React.ReactElement) => render(ui).container.firstElementChild as HTMLElement;

describe("InkWaveform", () => {
  it("draws the spoken phrase by default, hidden from assistive tech", () => {
    const el = root(<InkWaveform />);
    expect(el).toHaveAttribute("aria-hidden", "true");
    // The default phrase: 36 bars, its stressed peak tenth.
    expect(el.children).toHaveLength(36);
    expect((el.children[9] as HTMLElement).style.height).toBe("100%");
    expect(el.className).toContain("items-center");
    expect(el.style.gap).toBe("2px");
  });

  it("takes its own bars, width, gap and a bottom baseline", () => {
    const el = root(<InkWaveform bars={[0, 50, 140]} barWidth={4} gap={1} baseline className="text-primary" />);
    const bars = [...el.children] as HTMLElement[];
    // Clamped: never thinner than a tick, never past the box.
    expect(bars.map((b) => b.style.height)).toEqual(["4%", "50%", "100%"]);
    expect(bars[0].style.width).toBe("4px");
    expect(el.style.gap).toBe("1px");
    expect(el.className).toContain("items-end");
    expect(el.className).toContain("text-primary");
  });
});
