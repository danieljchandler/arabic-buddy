import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SceneEffect } from "@/lib/dances";
import { StageEffects } from "./StageEffects";

/**
 * The effects drawn in code over a vignette's figure. They are decoration, so
 * what matters is that the strength asked for is the strength drawn (a longer
 * streak has to look hotter), that the same scene always looks the same, and
 * that under reduced motion nothing is left animating.
 */

const anchor = { x: 50, y: 48 };

function draw(effects: SceneEffect[], heat: number, extra: { reduced?: boolean } = {}) {
  const { container } = render(<StageEffects effects={effects} heat={heat} anchor={anchor} {...extra} />);
  const count = (fx: string) => container.querySelectorAll(`[data-fx="${fx}"]`).length;
  return { container, count };
}

describe("StageEffects", () => {
  it("is decoration: hidden from screen readers, in both layers", () => {
    const { container } = draw(["fire"], 3);
    expect(container.children).toHaveLength(2);
    for (const layer of container.children) expect(layer).toHaveAttribute("aria-hidden", "true");
  });

  it("puts flames and smoke behind the figure and everything else in front", () => {
    const { container } = draw(["fire", "smoke", "steam", "sparkle"], 4);
    const [back, front] = container.children;
    expect(back).toHaveClass("cel-fx-back");
    expect(front).toHaveClass("cel-fx-front");
    expect(back.querySelectorAll('[data-fx="flame"], [data-fx="smoke"]').length).toBeGreaterThan(0);
    expect(back.querySelectorAll('[data-fx="ember"], [data-fx="steam"], [data-fx="sparkle"]')).toHaveLength(0);
    expect(front.querySelectorAll('[data-fx="flame"], [data-fx="smoke"]')).toHaveLength(0);
    expect(front.querySelectorAll('[data-fx="ember"], [data-fx="steam"], [data-fx="sparkle"]').length).toBeGreaterThan(0);
  });

  it("draws more flames and embers the hotter it is", () => {
    const counts = [1, 2, 3, 4, 5].map((heat) => {
      const { count } = draw(["fire"], heat);
      return { flames: count("flame"), embers: count("ember") };
    });
    expect(counts[0]).toEqual({ flames: 4, embers: 6 });
    expect(counts[4]).toEqual({ flames: 12, embers: 18 });
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i].flames).toBeGreaterThan(counts[i - 1].flames);
      expect(counts[i].embers).toBeGreaterThan(counts[i - 1].embers);
    }
  });

  it("keeps the strength between 1 and 5, however it is asked for", () => {
    expect(draw(["fire"], 0).count("flame")).toBe(draw(["fire"], 1).count("flame"));
    expect(draw(["fire"], 99).count("flame")).toBe(draw(["fire"], 5).count("flame"));
    expect(draw(["fire"], 2.6).count("flame")).toBe(draw(["fire"], 3).count("flame"));
  });

  it("starts the smoke over a fire only once the fire has some body", () => {
    expect(draw(["fire", "smoke"], 1).count("smoke")).toBe(0);
    expect(draw(["fire", "smoke"], 2).count("smoke")).toBe(1);
    expect(draw(["fire", "smoke"], 5).count("smoke")).toBe(4);
  });

  it("makes smoke on its own (incense) the whole effect", () => {
    const { count } = draw(["smoke"], 3);
    expect(count("smoke")).toBe(4);
    expect(count("flame")).toBe(0);
    expect(count("ember")).toBe(0);
  });

  it("draws only what it is asked for", () => {
    const sparkle = draw(["sparkle"], 3);
    expect(sparkle.count("sparkle")).toBe(10);
    expect(sparkle.count("flame") + sparkle.count("smoke") + sparkle.count("steam") + sparkle.count("ink")).toBe(0);

    const steam = draw(["steam"], 2);
    expect(steam.count("steam")).toBe(4);
    expect(steam.count("sparkle")).toBe(0);

    const ink = draw(["ink"], 2);
    expect(ink.count("ink")).toBe(1);
    expect(ink.container.querySelector("svg path")).toBeInTheDocument();
  });

  it("combines effects", () => {
    const { count } = draw(["steam", "sparkle"], 2);
    expect(count("steam")).toBeGreaterThan(0);
    expect(count("sparkle")).toBeGreaterThan(0);
  });

  it("stands each flame on the place the fire is lit", () => {
    const { container } = draw(["fire"], 3);
    for (const flame of container.querySelectorAll<HTMLElement>('[data-fx="flame"]')) {
      const top = Number.parseFloat(flame.style.top);
      const height = Number.parseFloat(flame.style.height);
      // The flame's foot is the anchor's y, to the rounding of the percentages.
      expect(top + height).toBeCloseTo(anchor.y, 1);
      const left = Number.parseFloat(flame.style.left);
      const width = Number.parseFloat(flame.style.width);
      expect(left + width / 2).toBeGreaterThan(anchor.x - 20);
      expect(left + width / 2).toBeLessThan(anchor.x + 20);
    }
  });

  it("looks the same every time a scene plays", () => {
    const a = draw(["fire", "smoke", "sparkle"], 4).container.innerHTML;
    const b = draw(["fire", "smoke", "sparkle"], 4).container.innerHTML;
    expect(a).toBe(b);
  });

  it("sits in place and does not animate under reduced motion", () => {
    for (const layer of draw(["fire"], 3).container.children) expect(layer).not.toHaveClass("cel-fx-still");
    for (const layer of draw(["fire"], 3, { reduced: true }).container.children) expect(layer).toHaveClass("cel-fx-still");
  });

  it("takes the figure's box, so it sits where the figure does", () => {
    const { container } = render(
      <StageEffects effects={["sparkle"]} heat={2} anchor={anchor} style={{ left: "30%" }} />,
    );
    for (const layer of container.children) expect((layer as HTMLElement).style.left).toBe("30%");
  });
});
